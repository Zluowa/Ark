import { Pool, type PoolClient } from "pg";
import { getServerEnv } from "@/lib/server/env";
import { recordRunEvent } from "@/lib/server/observability";
import {
  localRunRegistry,
  type LocalRunEvent,
  type LocalRunEventType,
} from "@/lib/server/local-run-registry";

type RunStatus = "accepted" | "running" | "succeeded" | "failed" | "cancelled";

export type RunEventType = LocalRunEventType;
export type RunEvent = LocalRunEvent;

export type RunPayload = {
  apiKeyId?: string;
  id: string;
  status: RunStatus;
  acceptedAt: number;
  spawnedBy?: string;
  spawnDepth: number;
  source?: string;
  startedAt?: number;
  tenantId?: string;
  endedAt?: number;
  error?: string;
};

export type RunCreateOptions = {
  apiKeyId?: string;
  spawnedBy?: string;
  spawnDepth?: number;
  source?: string;
  tenantId?: string;
};

export type RunWaitResult =
  | { state: "done"; run: RunPayload }
  | { state: "timeout"; run: RunPayload }
  | { state: "not_found" };

type RunListener = (event: RunEvent) => void;

type RunRegistryBackend = {
  attachAbortController: (
    runId: string,
    controller: AbortController,
  ) => Promise<void>;
  createAccepted: (
    runId: string,
    options?: RunCreateOptions,
  ) => Promise<RunPayload>;
  get: (runId: string) => Promise<RunPayload | undefined>;
  getEventsSince: (
    runId: string,
    afterEventId?: number,
  ) => Promise<RunEvent[] | undefined>;
  getRunIdByIdempotency: (
    key: string,
    source: string,
  ) => Promise<string | undefined>;
  markCancelled: (
    runId: string,
    reason?: string,
  ) => Promise<RunPayload | undefined>;
  markFailed: (runId: string, error: string) => Promise<RunPayload | undefined>;
  markRunning: (runId: string) => Promise<RunPayload | undefined>;
  markSucceeded: (runId: string) => Promise<RunPayload | undefined>;
  setIdempotency: (key: string, source: string, runId: string) => Promise<void>;
  subscribe: (
    runId: string,
    listener: RunListener,
  ) => Promise<(() => void) | undefined>;
  waitFor: (runId: string, timeoutMs?: number) => Promise<RunWaitResult>;
};

const TERMINAL = new Set<RunStatus>(["succeeded", "failed", "cancelled"]);

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const asNumber = (
  value: number | string | null | undefined,
): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const normalizeSource = (source: string | undefined): string => {
  const normalized = source?.trim().toLowerCase();
  return normalized || "default";
};

type LocalWaitShape =
  | { state: "done"; run: RunPayload }
  | { state: "timeout"; run: RunPayload }
  | { state: "not_found" };

class LocalRunRegistryAdapter implements RunRegistryBackend {
  async createAccepted(
    runId: string,
    options?: RunCreateOptions,
  ): Promise<RunPayload> {
    return localRunRegistry.createAccepted(runId, options) as RunPayload;
  }

  async attachAbortController(
    runId: string,
    controller: AbortController,
  ): Promise<void> {
    localRunRegistry.attachAbortController(runId, controller);
  }

  async get(runId: string): Promise<RunPayload | undefined> {
    return localRunRegistry.get(runId) as RunPayload | undefined;
  }

  async getRunIdByIdempotency(
    key: string,
    source: string,
  ): Promise<string | undefined> {
    return localRunRegistry.getRunIdByIdempotency(key, source);
  }

  async setIdempotency(
    key: string,
    source: string,
    runId: string,
  ): Promise<void> {
    localRunRegistry.setIdempotency(key, source, runId);
  }

  async markRunning(runId: string): Promise<RunPayload | undefined> {
    return localRunRegistry.markRunning(runId) as RunPayload | undefined;
  }

  async markSucceeded(runId: string): Promise<RunPayload | undefined> {
    return localRunRegistry.markSucceeded(runId) as RunPayload | undefined;
  }

  async markFailed(
    runId: string,
    error: string,
  ): Promise<RunPayload | undefined> {
    return localRunRegistry.markFailed(runId, error) as RunPayload | undefined;
  }

  async markCancelled(
    runId: string,
    reason = "cancelled by user",
  ): Promise<RunPayload | undefined> {
    return localRunRegistry.markCancelled(runId, reason) as
      | RunPayload
      | undefined;
  }

  async getEventsSince(
    runId: string,
    afterEventId = 0,
  ): Promise<RunEvent[] | undefined> {
    return localRunRegistry.getEventsSince(runId, afterEventId);
  }

  async subscribe(
    runId: string,
    listener: RunListener,
  ): Promise<(() => void) | undefined> {
    return localRunRegistry.subscribe(runId, listener);
  }

  async waitFor(runId: string, timeoutMs = 15000): Promise<RunWaitResult> {
    const waited = (await localRunRegistry.waitFor(
      runId,
      timeoutMs,
    )) as LocalWaitShape;
    return waited;
  }
}

type PgRunRow = {
  api_key_id: string | null;
  id: string;
  status: RunStatus;
  accepted_at: number | string;
  spawned_by: string | null;
  spawn_depth: number | string;
  source: string | null;
  started_at: number | string | null;
  tenant_id: string | null;
  ended_at: number | string | null;
  error: string | null;
  event_seq: number | string;
};

type PgRunEventRow = {
  event_id: number | string;
  run_id: string;
  type: RunEventType;
  status: RunStatus;
  timestamp: number | string;
  error: string | null;
};

type MutableRunState = RunPayload & {
  eventSeq: number;
};

const normalizeSpawnDepth = (
  value: number | string | null | undefined,
): number => {
  const parsed = asNumber(value);
  if (parsed === undefined) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
};

class PostgresRunRegistry implements RunRegistryBackend {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly listeners = new Map<string, Set<RunListener>>();
  private readonly maxErrorLength = 2000;
  private readonly pool: Pool;
  private schemaReady?: Promise<void>;
  private readonly waitPollIntervalMs = 250;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });
  }

  async createAccepted(
    runId: string,
    options?: RunCreateOptions,
  ): Promise<RunPayload> {
    const now = Date.now();
    const tenantId = options?.tenantId?.trim() || undefined;
    const apiKeyId = options?.apiKeyId?.trim() || undefined;
    const spawnedBy = options?.spawnedBy?.trim() || undefined;
    const spawnDepth = normalizeSpawnDepth(options?.spawnDepth);
    const source = options?.source?.trim() || undefined;
    const result = await this.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO omni_runs (
            id, status, accepted_at, event_seq,
            tenant_id, api_key_id, spawned_by, spawn_depth, source, updated_at
          )
          VALUES ($1, 'accepted', $2, 1, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `,
        [
          runId,
          now,
          tenantId ?? null,
          apiKeyId ?? null,
          spawnedBy ?? null,
          spawnDepth,
          source ?? null,
        ],
      );

      if ((inserted.rowCount ?? 0) > 0) {
        const run: RunPayload = {
          apiKeyId,
          id: runId,
          status: "accepted",
          acceptedAt: now,
          spawnedBy,
          spawnDepth,
          source,
          tenantId,
        };
        const event: RunEvent = {
          eventId: 1,
          runId,
          type: "run.accepted",
          status: "accepted",
          timestamp: now,
        };
        await client.query(
          `
            INSERT INTO omni_run_events (run_id, event_id, type, status, timestamp, error)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            event.runId,
            event.eventId,
            event.type,
            event.status,
            event.timestamp,
            null,
          ],
        );
        return { run, event };
      }

      const existing = await this.getRunState(client, runId, false);
      if (!existing) {
        throw new Error(`Run not found after upsert: ${runId}`);
      }
      return { run: this.toPayload(existing) };
    });

    if (result.event) {
      this.emit(result.event);
    }
    return result.run;
  }

  async attachAbortController(
    runId: string,
    controller: AbortController,
  ): Promise<void> {
    this.abortControllers.set(runId, controller);
  }

  async get(runId: string): Promise<RunPayload | undefined> {
    await this.ensureSchema();
    const res = await this.pool.query<PgRunRow>(
      `
        SELECT id, status, accepted_at, started_at, ended_at, error, event_seq,
               tenant_id, api_key_id, spawned_by, spawn_depth, source
        FROM omni_runs
        WHERE id = $1
      `,
      [runId],
    );
    if ((res.rowCount ?? 0) < 1) {
      return undefined;
    }
    return this.toPayload(this.rowToState(res.rows[0]));
  }

  async getRunIdByIdempotency(
    key: string,
    source: string,
  ): Promise<string | undefined> {
    const normalizedKey = key.trim();
    if (!normalizedKey) return undefined;
    const normalizedSource = normalizeSource(source);

    await this.ensureSchema();
    const res = await this.pool.query<{ run_id: string }>(
      `
        SELECT run_id
        FROM omni_run_idempotency
        WHERE source = $1 AND idempotency_key = $2
      `,
      [normalizedSource, normalizedKey],
    );
    if ((res.rowCount ?? 0) < 1) {
      return undefined;
    }

    const runId = res.rows[0]?.run_id;
    if (!runId) {
      return undefined;
    }

    const run = await this.get(runId);
    if (!run) {
      await this.pool.query(
        `
          DELETE FROM omni_run_idempotency
          WHERE source = $1 AND idempotency_key = $2
        `,
        [normalizedSource, normalizedKey],
      );
      return undefined;
    }

    await this.pool.query(
      `
        UPDATE omni_run_idempotency
        SET updated_at = $3
        WHERE source = $1 AND idempotency_key = $2
      `,
      [normalizedSource, normalizedKey, Date.now()],
    );
    return runId;
  }

  async setIdempotency(
    key: string,
    source: string,
    runId: string,
  ): Promise<void> {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    const normalizedSource = normalizeSource(source);
    const now = Date.now();

    await this.ensureSchema();
    await this.pool.query(
      `
        INSERT INTO omni_run_idempotency (source, idempotency_key, run_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (source, idempotency_key)
        DO UPDATE SET run_id = EXCLUDED.run_id, updated_at = EXCLUDED.updated_at
      `,
      [normalizedSource, normalizedKey, runId, now, now],
    );
  }

  async markRunning(runId: string): Promise<RunPayload | undefined> {
    return this.update(runId, "run.running", (run) => {
      if (TERMINAL.has(run.status)) return;
      run.status = "running";
      run.startedAt ??= Date.now();
      run.error = undefined;
    });
  }

  async markSucceeded(runId: string): Promise<RunPayload | undefined> {
    return this.update(runId, "run.succeeded", (run) => {
      if (TERMINAL.has(run.status)) return;
      run.status = "succeeded";
      run.startedAt ??= run.acceptedAt;
      run.endedAt = Date.now();
      run.error = undefined;
    });
  }

  async markFailed(
    runId: string,
    error: string,
  ): Promise<RunPayload | undefined> {
    return this.update(runId, "run.failed", (run) => {
      if (TERMINAL.has(run.status)) return;
      run.status = "failed";
      run.startedAt ??= run.acceptedAt;
      run.endedAt = Date.now();
      run.error = error.slice(0, this.maxErrorLength);
    });
  }

  async markCancelled(
    runId: string,
    reason = "cancelled by user",
  ): Promise<RunPayload | undefined> {
    return this.update(runId, "run.cancelled", (run) => {
      if (TERMINAL.has(run.status)) return;
      this.abortControllers.get(runId)?.abort(reason);
      run.status = "cancelled";
      run.startedAt ??= run.acceptedAt;
      run.endedAt = Date.now();
      run.error = reason.slice(0, this.maxErrorLength);
    });
  }

  async getEventsSince(
    runId: string,
    afterEventId = 0,
  ): Promise<RunEvent[] | undefined> {
    await this.ensureSchema();
    const exists = await this.pool.query<{ id: string }>(
      `
        SELECT id FROM omni_runs WHERE id = $1
      `,
      [runId],
    );
    if ((exists.rowCount ?? 0) < 1) {
      return undefined;
    }

    const res = await this.pool.query<PgRunEventRow>(
      `
        SELECT event_id, run_id, type, status, timestamp, error
        FROM omni_run_events
        WHERE run_id = $1 AND event_id > $2
        ORDER BY event_id ASC
        LIMIT 1000
      `,
      [runId, Math.max(0, Math.floor(afterEventId))],
    );

    return res.rows.map((row) => this.rowToEvent(row));
  }

  async subscribe(
    runId: string,
    listener: RunListener,
  ): Promise<(() => void) | undefined> {
    const run = await this.get(runId);
    if (!run) {
      return undefined;
    }

    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set<RunListener>();
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

  async waitFor(runId: string, timeoutMs = 15000): Promise<RunWaitResult> {
    const normalizedTimeout = Math.max(1, Math.floor(timeoutMs));
    const startedAt = Date.now();

    while (true) {
      const run = await this.get(runId);
      if (!run) {
        return { state: "not_found" };
      }

      if (TERMINAL.has(run.status)) {
        return { state: "done", run };
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= normalizedTimeout) {
        return { state: "timeout", run };
      }

      const remaining = normalizedTimeout - elapsed;
      await sleep(Math.min(this.waitPollIntervalMs, remaining));
    }
  }

  private async update(
    runId: string,
    eventType: RunEventType,
    mutator: (run: MutableRunState) => void,
  ): Promise<RunPayload | undefined> {
    const result = await this.withTransaction(async (client) => {
      const current = await this.getRunState(client, runId, true);
      if (!current) {
        return undefined;
      }

      const next: MutableRunState = { ...current };
      mutator(next);
      next.error = next.error?.slice(0, this.maxErrorLength);

      const changed =
        current.status !== next.status ||
        current.startedAt !== next.startedAt ||
        current.endedAt !== next.endedAt ||
        current.error !== next.error;

      if (!changed) {
        return { run: this.toPayload(current) };
      }

      const eventId = current.eventSeq + 1;
      const eventTimestamp = Date.now();
      next.eventSeq = eventId;
      await client.query(
        `
          UPDATE omni_runs
          SET status = $2,
              started_at = $3,
              ended_at = $4,
              error = $5,
              event_seq = $6,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          runId,
          next.status,
          next.startedAt ?? null,
          next.endedAt ?? null,
          next.error ?? null,
          next.eventSeq,
        ],
      );

      const event: RunEvent = {
        eventId,
        runId,
        type: eventType,
        status: next.status,
        timestamp: eventTimestamp,
        error: next.error,
      };

      await client.query(
        `
          INSERT INTO omni_run_events (run_id, event_id, type, status, timestamp, error)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          event.runId,
          event.eventId,
          event.type,
          event.status,
          event.timestamp,
          event.error ?? null,
        ],
      );

      return { run: this.toPayload(next), event };
    });

    if (!result) {
      return undefined;
    }

    if (result.event) {
      this.emit(result.event);
    }

    if (TERMINAL.has(result.run.status)) {
      this.abortControllers.delete(runId);
    }

    return result.run;
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool
        .query(`
        CREATE TABLE IF NOT EXISTS omni_runs (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          accepted_at BIGINT NOT NULL,
          tenant_id TEXT,
          api_key_id TEXT,
          spawned_by TEXT,
          spawn_depth INTEGER NOT NULL DEFAULT 0,
          source TEXT,
          started_at BIGINT,
          ended_at BIGINT,
          error TEXT,
          event_seq INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE omni_runs ADD COLUMN IF NOT EXISTS tenant_id TEXT;
        ALTER TABLE omni_runs ADD COLUMN IF NOT EXISTS api_key_id TEXT;
        ALTER TABLE omni_runs ADD COLUMN IF NOT EXISTS spawned_by TEXT;
        ALTER TABLE omni_runs ADD COLUMN IF NOT EXISTS spawn_depth INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE omni_runs ADD COLUMN IF NOT EXISTS source TEXT;

        CREATE INDEX IF NOT EXISTS idx_omni_runs_tenant_id
          ON omni_runs (tenant_id);

        CREATE TABLE IF NOT EXISTS omni_run_events (
          run_id TEXT NOT NULL REFERENCES omni_runs(id) ON DELETE CASCADE,
          event_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          timestamp BIGINT NOT NULL,
          error TEXT,
          PRIMARY KEY (run_id, event_id)
        );

        CREATE INDEX IF NOT EXISTS idx_omni_run_events_run_id_event_id
          ON omni_run_events (run_id, event_id);

        CREATE TABLE IF NOT EXISTS omni_run_idempotency (
          source TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          run_id TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (source, idempotency_key)
        );

        CREATE INDEX IF NOT EXISTS idx_omni_run_idempotency_run_id
          ON omni_run_idempotency (run_id);
      `)
        .then(() => undefined);
    }
    await this.schemaReady;
  }

  private async withTransaction<T>(
    runner: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await runner(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback errors.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async getRunState(
    client: PoolClient,
    runId: string,
    forUpdate: boolean,
  ): Promise<MutableRunState | undefined> {
    const res = await client.query<PgRunRow>(
      `
        SELECT id, status, accepted_at, started_at, ended_at, error, event_seq, tenant_id, api_key_id, source
               , spawned_by, spawn_depth
        FROM omni_runs
        WHERE id = $1
        ${forUpdate ? "FOR UPDATE" : ""}
      `,
      [runId],
    );
    if ((res.rowCount ?? 0) < 1) {
      return undefined;
    }
    return this.rowToState(res.rows[0]);
  }

  private rowToState(row: PgRunRow): MutableRunState {
    const acceptedAt = asNumber(row.accepted_at);
    const eventSeq = asNumber(row.event_seq);
    if (acceptedAt === undefined || eventSeq === undefined) {
      throw new Error(`Invalid run row shape for ${row.id}`);
    }
    return {
      apiKeyId: row.api_key_id ?? undefined,
      id: row.id,
      status: row.status,
      acceptedAt,
      spawnedBy: row.spawned_by ?? undefined,
      spawnDepth: normalizeSpawnDepth(row.spawn_depth),
      source: row.source ?? undefined,
      startedAt: asNumber(row.started_at),
      tenantId: row.tenant_id ?? undefined,
      endedAt: asNumber(row.ended_at),
      error: row.error ?? undefined,
      eventSeq,
    };
  }

  private rowToEvent(row: PgRunEventRow): RunEvent {
    const eventId = asNumber(row.event_id);
    const timestamp = asNumber(row.timestamp);
    if (eventId === undefined || timestamp === undefined) {
      throw new Error(`Invalid event row shape for run ${row.run_id}`);
    }
    return {
      eventId,
      runId: row.run_id,
      type: row.type,
      status: row.status,
      timestamp,
      error: row.error ?? undefined,
    };
  }

  private toPayload(state: MutableRunState): RunPayload {
    return {
      apiKeyId: state.apiKeyId,
      id: state.id,
      status: state.status,
      acceptedAt: state.acceptedAt,
      spawnedBy: state.spawnedBy,
      spawnDepth: state.spawnDepth,
      source: state.source,
      startedAt: state.startedAt,
      tenantId: state.tenantId,
      endedAt: state.endedAt,
      error: state.error,
    };
  }

  private emit(event: RunEvent): void {
    recordRunEvent(event);
    const set = this.listeners.get(event.runId);
    if (!set || set.size === 0) {
      return;
    }

    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Keep event delivery resilient when a listener throws.
      }
    }
  }
}

const createRunRegistry = (): RunRegistryBackend => {
  const env = getServerEnv();
  if (env.runStore === "postgres" && env.databaseUrl) {
    return new PostgresRunRegistry(env.databaseUrl);
  }
  return new LocalRunRegistryAdapter();
};

export const runRegistry = createRunRegistry();
