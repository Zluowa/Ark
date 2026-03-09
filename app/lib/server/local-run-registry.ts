import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

type LocalRunStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type LocalRunEventType =
  | "run.accepted"
  | "run.running"
  | "run.succeeded"
  | "run.failed"
  | "run.cancelled";

export type LocalRunEvent = {
  eventId: number;
  runId: string;
  type: LocalRunEventType;
  status: LocalRunStatus;
  timestamp: number;
  error?: string;
};

type PersistedRunRecord = {
  apiKeyId?: string;
  id: string;
  status: LocalRunStatus;
  acceptedAt: number;
  spawnedBy?: string;
  spawnDepth: number;
  source?: string;
  startedAt?: number;
  tenantId?: string;
  endedAt?: number;
  error?: string;
  eventSeq: number;
  events: LocalRunEvent[];
};

type LocalRunRecord = PersistedRunRecord & {
  abortController?: AbortController;
};

type LocalRunPayload = {
  apiKeyId?: string;
  id: string;
  status: LocalRunStatus;
  acceptedAt: number;
  spawnedBy?: string;
  spawnDepth: number;
  source?: string;
  startedAt?: number;
  tenantId?: string;
  endedAt?: number;
  error?: string;
};

type RunCreateMeta = {
  apiKeyId?: string;
  spawnedBy?: string;
  spawnDepth?: number;
  source?: string;
  tenantId?: string;
};

type WaitResult =
  | { state: "done"; run: LocalRunPayload }
  | { state: "timeout"; run: LocalRunPayload }
  | { state: "not_found" };

type EventListener = (event: LocalRunEvent) => void;

type IdempotencyRecord = {
  key: string;
  source: string;
  runId: string;
  createdAt: number;
  updatedAt: number;
};

const TERMINAL = new Set<LocalRunStatus>(["succeeded", "failed", "cancelled"]);
const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const RUNS_DIR = join(STORAGE_ROOT, "runs");
const IDEMPOTENCY_INDEX_FILE = join(STORAGE_ROOT, "idempotency-index.json");

const cloneRun = (run: LocalRunRecord): LocalRunPayload => {
  return {
    apiKeyId: run.apiKeyId,
    id: run.id,
    status: run.status,
    acceptedAt: run.acceptedAt,
    spawnedBy: run.spawnedBy,
    spawnDepth: run.spawnDepth,
    source: run.source,
    startedAt: run.startedAt,
    tenantId: run.tenantId,
    endedAt: run.endedAt,
    error: run.error,
  };
};

const normalizeSpawnDepth = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const safeParsePersistedRun = (raw: string): PersistedRunRecord | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedRunRecord>;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    if (typeof parsed.id !== "string" || !parsed.id) {
      return undefined;
    }
    if (
      parsed.status !== "accepted" &&
      parsed.status !== "running" &&
      parsed.status !== "succeeded" &&
      parsed.status !== "failed" &&
      parsed.status !== "cancelled"
    ) {
      return undefined;
    }
    if (typeof parsed.acceptedAt !== "number") {
      return undefined;
    }

    const events = Array.isArray(parsed.events)
      ? parsed.events.filter((event): event is LocalRunEvent => {
          if (!event || typeof event !== "object") return false;
          return (
            typeof event.eventId === "number" &&
            typeof event.runId === "string" &&
            typeof event.type === "string" &&
            typeof event.status === "string" &&
            typeof event.timestamp === "number"
          );
        })
      : [];

    const spawnedBy =
      typeof parsed.spawnedBy === "string" && parsed.spawnedBy.trim()
        ? parsed.spawnedBy.trim()
        : undefined;
    const spawnDepth = normalizeSpawnDepth(parsed.spawnDepth);

    return {
      apiKeyId:
        typeof parsed.apiKeyId === "string" ? parsed.apiKeyId : undefined,
      id: parsed.id,
      status: parsed.status,
      acceptedAt: parsed.acceptedAt,
      spawnedBy,
      spawnDepth,
      source: typeof parsed.source === "string" ? parsed.source : undefined,
      startedAt: parsed.startedAt,
      tenantId:
        typeof parsed.tenantId === "string" ? parsed.tenantId : undefined,
      endedAt: parsed.endedAt,
      error: parsed.error,
      eventSeq:
        typeof parsed.eventSeq === "number" && Number.isFinite(parsed.eventSeq)
          ? parsed.eventSeq
          : events.length,
      events,
    };
  } catch {
    return undefined;
  }
};

const safeParseIdempotencyIndex = (raw: string): IdempotencyRecord[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }

    const values = Object.values(parsed);
    const result: IdempotencyRecord[] = [];
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const item = value as Partial<IdempotencyRecord>;
      if (
        typeof item.key !== "string" ||
        typeof item.source !== "string" ||
        typeof item.runId !== "string" ||
        typeof item.createdAt !== "number" ||
        typeof item.updatedAt !== "number"
      ) {
        continue;
      }
      result.push({
        key: item.key,
        source: item.source,
        runId: item.runId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    }

    return result;
  } catch {
    return [];
  }
};

class LocalRunRegistry {
  private readonly runs = new Map<string, LocalRunRecord>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly maxRuns = 2000;
  private readonly maxEventsPerRun = 500;
  private readonly maxIdempotencyEntries = 20000;
  private readonly waitPollIntervalMs = 250;
  private storageReady = false;
  private idempotencyLoaded = false;

  createAccepted(runId: string, meta?: RunCreateMeta): LocalRunPayload {
    const existing = this.getRecord(runId);
    if (existing) {
      return cloneRun(existing);
    }

    const run: LocalRunRecord = {
      apiKeyId: meta?.apiKeyId,
      id: runId,
      status: "accepted",
      acceptedAt: Date.now(),
      spawnedBy: meta?.spawnedBy?.trim() || undefined,
      spawnDepth: normalizeSpawnDepth(meta?.spawnDepth),
      source: meta?.source,
      tenantId: meta?.tenantId,
      eventSeq: 0,
      events: [],
    };

    this.runs.set(runId, run);
    this.emitRunEvent(run, "run.accepted");
    this.persistRun(run);
    this.prune();
    return cloneRun(run);
  }

  attachAbortController(runId: string, controller: AbortController): void {
    const run = this.getRecord(runId);
    if (!run) return;
    run.abortController = controller;
    this.runs.set(runId, run);
  }

  get(runId: string): LocalRunPayload | undefined {
    const run = this.getRecord(runId);
    return run ? cloneRun(run) : undefined;
  }

  getRunIdByIdempotency(key: string, source: string): string | undefined {
    const normalizedKey = key.trim();
    if (!normalizedKey) return undefined;
    const normalizedSource = this.normalizeSource(source);
    const indexKey = this.makeIdempotencyIndexKey(
      normalizedKey,
      normalizedSource,
    );
    const entry = this.getIdempotencyEntry(indexKey);
    if (!entry) return undefined;

    const run = this.getRecord(entry.runId);
    if (!run) {
      this.idempotency.delete(indexKey);
      this.persistIdempotencyIndex();
      return undefined;
    }

    entry.updatedAt = Date.now();
    this.idempotency.set(indexKey, entry);
    return entry.runId;
  }

  setIdempotency(key: string, source: string, runId: string): void {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    const normalizedSource = this.normalizeSource(source);
    const indexKey = this.makeIdempotencyIndexKey(
      normalizedKey,
      normalizedSource,
    );
    const now = Date.now();
    const existing = this.getIdempotencyEntry(indexKey);

    const next: IdempotencyRecord = {
      key: normalizedKey,
      source: normalizedSource,
      runId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.idempotency.set(indexKey, next);
    this.pruneIdempotency();
    this.persistIdempotencyIndex();
  }

  markRunning(runId: string): LocalRunPayload | undefined {
    return this.update(
      runId,
      (run) => {
        if (TERMINAL.has(run.status)) return;
        run.status = "running";
        run.startedAt ??= Date.now();
        delete run.error;
      },
      "run.running",
    );
  }

  markSucceeded(runId: string): LocalRunPayload | undefined {
    return this.update(
      runId,
      (run) => {
        if (TERMINAL.has(run.status)) return;
        run.status = "succeeded";
        run.startedAt ??= run.acceptedAt;
        run.endedAt = Date.now();
        delete run.error;
      },
      "run.succeeded",
    );
  }

  markFailed(runId: string, error: string): LocalRunPayload | undefined {
    return this.update(
      runId,
      (run) => {
        if (TERMINAL.has(run.status)) return;
        run.status = "failed";
        run.startedAt ??= run.acceptedAt;
        run.endedAt = Date.now();
        run.error = error.slice(0, 2000);
      },
      "run.failed",
    );
  }

  markCancelled(
    runId: string,
    reason = "cancelled by user",
  ): LocalRunPayload | undefined {
    return this.update(
      runId,
      (run) => {
        if (TERMINAL.has(run.status)) return;
        run.abortController?.abort(reason);
        run.status = "cancelled";
        run.startedAt ??= run.acceptedAt;
        run.endedAt = Date.now();
        run.error = reason.slice(0, 2000);
      },
      "run.cancelled",
    );
  }

  getEventsSince(runId: string, afterEventId = 0): LocalRunEvent[] | undefined {
    const run = this.getRecord(runId);
    if (!run) return undefined;
    return run.events.filter((event) => event.eventId > afterEventId);
  }

  subscribe(runId: string, listener: EventListener): (() => void) | undefined {
    if (!this.getRecord(runId)) {
      return undefined;
    }

    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set<EventListener>();
      this.listeners.set(runId, set);
    }
    set.add(listener);

    return () => {
      const current = this.listeners.get(runId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  async waitFor(runId: string, timeoutMs = 15000): Promise<WaitResult> {
    const normalizedTimeout = Math.max(1, Math.floor(timeoutMs));
    const startedAt = Date.now();

    while (true) {
      const run = this.getRecord(runId);
      if (!run) {
        return { state: "not_found" };
      }

      if (TERMINAL.has(run.status)) {
        return { state: "done", run: cloneRun(run) };
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= normalizedTimeout) {
        return { state: "timeout", run: cloneRun(run) };
      }

      const remaining = normalizedTimeout - elapsed;
      await sleep(Math.min(this.waitPollIntervalMs, remaining));
    }
  }

  private update(
    runId: string,
    mutator: (run: LocalRunRecord) => void,
    eventType: LocalRunEventType,
  ): LocalRunPayload | undefined {
    const run = this.getRecord(runId);
    if (!run) {
      return undefined;
    }

    const previousStatus = run.status;
    const previousStartedAt = run.startedAt;
    const previousEndedAt = run.endedAt;
    const previousError = run.error;
    mutator(run);

    const changed =
      previousStatus !== run.status ||
      previousStartedAt !== run.startedAt ||
      previousEndedAt !== run.endedAt ||
      previousError !== run.error;

    if (!changed) {
      return cloneRun(run);
    }

    this.emitRunEvent(run, eventType);
    this.persistRun(run);
    return cloneRun(run);
  }

  private emitRunEvent(run: LocalRunRecord, type: LocalRunEventType): void {
    run.eventSeq += 1;
    const event: LocalRunEvent = {
      eventId: run.eventSeq,
      runId: run.id,
      type,
      status: run.status,
      timestamp: Date.now(),
      error: run.error,
    };

    run.events.push(event);
    if (run.events.length > this.maxEventsPerRun) {
      run.events.shift();
    }

    const set = this.listeners.get(run.id);
    if (!set || set.size === 0) {
      return;
    }

    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Keep registry stable even if one consumer throws.
      }
    }
  }

  private normalizeSource(source: string | undefined): string {
    const normalized = source?.trim().toLowerCase();
    return normalized || "default";
  }

  private makeIdempotencyIndexKey(key: string, source: string): string {
    return `${source}\u0000${key}`;
  }

  private getIdempotencyEntry(indexKey: string): IdempotencyRecord | undefined {
    this.syncIdempotencyFromDisk();
    return this.idempotency.get(indexKey);
  }

  private syncIdempotencyFromDisk(): void {
    this.ensureStorageDir();
    this.idempotencyLoaded = true;
    this.idempotency.clear();

    if (!existsSync(IDEMPOTENCY_INDEX_FILE)) {
      return;
    }

    try {
      const raw = readFileSync(IDEMPOTENCY_INDEX_FILE, "utf8");
      const entries = safeParseIdempotencyIndex(raw);
      for (const entry of entries) {
        const indexKey = this.makeIdempotencyIndexKey(entry.key, entry.source);
        this.idempotency.set(indexKey, entry);
      }
      this.pruneIdempotency();
    } catch {
      // Ignore parse/read errors and keep index empty.
    }
  }

  private persistIdempotencyIndex(): void {
    this.ensureStorageDir();
    if (!this.idempotencyLoaded) {
      this.syncIdempotencyFromDisk();
    }

    const payload: Record<string, IdempotencyRecord> = {};
    for (const [indexKey, entry] of this.idempotency.entries()) {
      payload[indexKey] = entry;
    }

    try {
      const tempPath = `${IDEMPOTENCY_INDEX_FILE}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload), "utf8");
      renameSync(tempPath, IDEMPOTENCY_INDEX_FILE);
    } catch (error) {
      console.error(
        `[local-run-registry] persist idempotency failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private pruneIdempotency(): void {
    if (this.idempotency.size <= this.maxIdempotencyEntries) {
      return;
    }

    const entries = [...this.idempotency.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );

    for (const [indexKey] of entries) {
      if (this.idempotency.size <= this.maxIdempotencyEntries) {
        break;
      }
      this.idempotency.delete(indexKey);
    }
  }

  private removeIdempotencyByRunId(runId: string): void {
    this.syncIdempotencyFromDisk();
    let removed = false;
    for (const [indexKey, entry] of this.idempotency.entries()) {
      if (entry.runId !== runId) {
        continue;
      }
      this.idempotency.delete(indexKey);
      removed = true;
    }
    if (removed) {
      this.persistIdempotencyIndex();
    }
  }

  private getRecord(runId: string): LocalRunRecord | undefined {
    const fromDisk = this.readRunFromDisk(runId);
    if (fromDisk) {
      const cached = this.runs.get(runId);
      const hydrated: LocalRunRecord = {
        ...fromDisk,
        abortController: cached?.abortController,
      };
      this.runs.set(runId, hydrated);
      return hydrated;
    }

    return this.runs.get(runId);
  }

  private persistRun(run: LocalRunRecord): void {
    this.ensureStorageDir();
    const payload: PersistedRunRecord = {
      apiKeyId: run.apiKeyId,
      id: run.id,
      status: run.status,
      acceptedAt: run.acceptedAt,
      spawnedBy: run.spawnedBy,
      spawnDepth: run.spawnDepth,
      source: run.source,
      startedAt: run.startedAt,
      tenantId: run.tenantId,
      endedAt: run.endedAt,
      error: run.error,
      eventSeq: run.eventSeq,
      events: run.events,
    };

    try {
      const finalPath = this.getRunFilePath(run.id);
      const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload), "utf8");
      renameSync(tempPath, finalPath);
    } catch (error) {
      console.error(
        `[local-run-registry] persist failed for run ${run.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private readRunFromDisk(runId: string): PersistedRunRecord | undefined {
    this.ensureStorageDir();
    const runPath = this.getRunFilePath(runId);
    if (!existsSync(runPath)) {
      return undefined;
    }

    try {
      const raw = readFileSync(runPath, "utf8");
      const parsed = safeParsePersistedRun(raw);
      if (!parsed) {
        rmSync(runPath, { force: true });
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private getRunFilePath(runId: string): string {
    return join(RUNS_DIR, `${runId}.json`);
  }

  private ensureStorageDir(): void {
    if (this.storageReady) return;
    mkdirSync(RUNS_DIR, { recursive: true });
    this.storageReady = true;
  }

  private prune(): void {
    if (this.runs.size <= this.maxRuns) return;

    for (const [runId, run] of this.runs) {
      if (this.runs.size <= this.maxRuns) {
        break;
      }
      if (!TERMINAL.has(run.status)) {
        continue;
      }
      if (this.listeners.has(runId)) {
        continue;
      }
      this.runs.delete(runId);
      this.removeIdempotencyByRunId(runId);
      try {
        rmSync(this.getRunFilePath(runId), { force: true });
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
}

export const localRunRegistry = new LocalRunRegistry();
