import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type ToolJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type ToolJobRecord = {
  apiKeyId?: string;
  jobId: string;
  runId: string;
  tenantId?: string;
  tool: string;
  status: ToolJobStatus;
  progress?: number;
  etaMs?: number;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
};

export type ToolJobOwner = {
  apiKeyId?: string;
  tenantId?: string;
};

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const JOBS_DIR = join(STORAGE_ROOT, "jobs");

const clampProgress = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const sanitize = (record: ToolJobRecord): ToolJobRecord => {
  return {
    ...record,
    progress:
      typeof record.progress === "number"
        ? clampProgress(record.progress)
        : undefined,
  };
};

const readJson = (filePath: string): unknown | undefined => {
  if (!existsSync(filePath)) return undefined;
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return undefined;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toRecord = (value: unknown): ToolJobRecord | undefined => {
  if (!isObject(value)) return undefined;
  if (
    typeof value.jobId !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.tool !== "string" ||
    typeof value.status !== "string" ||
    typeof value.createdAt !== "number"
  ) {
    return undefined;
  }

  const allowed = new Set<ToolJobStatus>([
    "queued",
    "processing",
    "completed",
    "failed",
    "cancelled",
  ]);
  if (!allowed.has(value.status as ToolJobStatus)) {
    return undefined;
  }

  const error =
    isObject(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
      ? { code: value.error.code, message: value.error.message }
      : undefined;

  return sanitize({
    apiKeyId: typeof value.apiKeyId === "string" ? value.apiKeyId : undefined,
    jobId: value.jobId,
    runId: value.runId,
    tenantId: typeof value.tenantId === "string" ? value.tenantId : undefined,
    tool: value.tool,
    status: value.status as ToolJobStatus,
    progress:
      typeof value.progress === "number"
        ? clampProgress(value.progress)
        : undefined,
    etaMs: typeof value.etaMs === "number" ? value.etaMs : undefined,
    result: isObject(value.result) ? value.result : undefined,
    error,
    createdAt: value.createdAt,
    startedAt:
      typeof value.startedAt === "number" ? value.startedAt : undefined,
    completedAt:
      typeof value.completedAt === "number" ? value.completedAt : undefined,
    durationMs:
      typeof value.durationMs === "number" ? value.durationMs : undefined,
  });
};

class ToolJobRegistry {
  private storageReady = false;
  private readonly jobs = new Map<string, ToolJobRecord>();

  createQueued(
    jobId: string,
    tool: string,
    etaMs?: number,
    owner?: ToolJobOwner,
  ): ToolJobRecord {
    const now = Date.now();
    const record: ToolJobRecord = {
      apiKeyId: owner?.apiKeyId,
      jobId,
      runId: jobId,
      tenantId: owner?.tenantId,
      tool,
      status: "queued",
      progress: 0,
      etaMs,
      createdAt: now,
    };
    this.jobs.set(jobId, record);
    this.persist(record);
    return record;
  }

  markProcessing(jobId: string, etaMs?: number): ToolJobRecord | undefined {
    return this.update(jobId, (record) => {
      if (record.status === "completed" || record.status === "failed") {
        return;
      }
      record.status = "processing";
      record.startedAt ??= Date.now();
      record.progress = 0.25;
      if (typeof etaMs === "number" && Number.isFinite(etaMs)) {
        record.etaMs = Math.max(0, Math.floor(etaMs));
      }
      record.error = undefined;
    });
  }

  markCompleted(
    jobId: string,
    result: Record<string, unknown>,
    durationMs: number,
  ): ToolJobRecord | undefined {
    return this.update(jobId, (record) => {
      record.status = "completed";
      record.startedAt ??= record.createdAt;
      record.completedAt = Date.now();
      record.durationMs = Math.max(1, Math.floor(durationMs));
      record.progress = 1;
      record.etaMs = 0;
      record.result = result;
      record.error = undefined;
    });
  }

  markFailed(
    jobId: string,
    code: string,
    message: string,
    durationMs?: number,
  ): ToolJobRecord | undefined {
    return this.update(jobId, (record) => {
      record.status = "failed";
      record.startedAt ??= record.createdAt;
      record.completedAt = Date.now();
      record.durationMs =
        typeof durationMs === "number" && Number.isFinite(durationMs)
          ? Math.max(1, Math.floor(durationMs))
          : undefined;
      record.progress = 1;
      record.etaMs = 0;
      record.error = { code, message };
    });
  }

  get(jobId: string): ToolJobRecord | undefined {
    const fromDisk = this.readFromDisk(jobId);
    if (fromDisk) {
      this.jobs.set(jobId, fromDisk);
      return fromDisk;
    }
    return this.jobs.get(jobId);
  }

  listRecent(limit = 50): ToolJobRecord[] {
    this.ensureStorage();
    const files = readdirSync(JOBS_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(JOBS_DIR, name));

    const items: ToolJobRecord[] = [];
    for (const filePath of files) {
      const parsed = toRecord(readJson(filePath));
      if (!parsed) continue;
      items.push(parsed);
    }
    return items
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(200, Math.floor(limit))));
  }

  private update(
    jobId: string,
    mutator: (record: ToolJobRecord) => void,
  ): ToolJobRecord | undefined {
    const current = this.get(jobId);
    if (!current) return undefined;
    const next = { ...current };
    mutator(next);
    const sanitized = sanitize(next);
    this.jobs.set(jobId, sanitized);
    this.persist(sanitized);
    return sanitized;
  }

  private persist(record: ToolJobRecord): void {
    this.ensureStorage();
    const finalPath = this.getJobPath(record.jobId);
    const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(record), "utf8");
    renameSync(tempPath, finalPath);
  }

  private readFromDisk(jobId: string): ToolJobRecord | undefined {
    this.ensureStorage();
    return toRecord(readJson(this.getJobPath(jobId)));
  }

  private getJobPath(jobId: string): string {
    return join(JOBS_DIR, `${jobId}.json`);
  }

  private ensureStorage(): void {
    if (this.storageReady) return;
    mkdirSync(JOBS_DIR, { recursive: true });
    this.storageReady = true;
  }
}

export const toolJobRegistry = new ToolJobRegistry();
