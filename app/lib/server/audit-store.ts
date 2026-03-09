// @input: AuditEvent records from security-controls, databaseUrl from env
// @output: persist() writes events to JSONL file or Postgres; list() queries them
// @position: persistence layer for audit trail — local JSONL or Postgres batch backend

import { appendFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { type AuditEvent } from "@/lib/server/security-controls";
import { getServerEnv } from "@/lib/server/env";

export type AuditListFilter = {
  action?: string;
  limit?: number;
  since?: number;
  tenantId?: string;
};

type AuditStoreBackend = {
  persist: (event: AuditEvent) => Promise<void>;
  list: (filter: AuditListFilter) => Promise<AuditEvent[]>;
};

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const AUDIT_DIR = join(STORAGE_ROOT, "audit");

const toDateKey = (timestamp: number): string => {
  return new Date(timestamp).toISOString().slice(0, 10);
};

const clampLimit = (value: number | undefined, fallback = 100): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(value)));
};

const toJsonLine = (event: AuditEvent): string => {
  return JSON.stringify({
    ts: new Date(event.timestamp).toISOString(),
    action: event.action,
    outcome: event.outcome,
    route: event.route,
    method: event.method,
    tenant_id: event.tenantId,
    api_key_id: event.apiKeyId,
    trace_id: event.traceId,
    request_id: event.requestId,
    details: event.details,
  });
};

const fromJsonLine = (line: string): AuditEvent | undefined => {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (typeof raw.ts !== "string" || typeof raw.outcome !== "string") return undefined;
    const ts = Date.parse(raw.ts);
    if (!Number.isFinite(ts)) return undefined;
    return {
      action: typeof raw.action === "string" ? raw.action : "unknown",
      apiKeyId: typeof raw.api_key_id === "string" ? raw.api_key_id : undefined,
      details: raw.details as Record<string, unknown> | undefined,
      method: typeof raw.method === "string" ? raw.method : undefined,
      outcome: raw.outcome as AuditEvent["outcome"],
      requestId: typeof raw.request_id === "string" ? raw.request_id : undefined,
      route: typeof raw.route === "string" ? raw.route : undefined,
      tenantId: typeof raw.tenant_id === "string" ? raw.tenant_id : undefined,
      timestamp: ts,
      traceId: typeof raw.trace_id === "string" ? raw.trace_id : undefined,
    };
  } catch {
    return undefined;
  }
};

class LocalAuditStore implements AuditStoreBackend {
  private storageReady = false;

  async persist(event: AuditEvent): Promise<void> {
    this.ensureStorage();
    const dateKey = toDateKey(event.timestamp);
    const filePath = join(AUDIT_DIR, `${dateKey}.jsonl`);
    await appendFile(filePath, toJsonLine(event) + "\n", "utf8");
  }

  async list(filter: AuditListFilter): Promise<AuditEvent[]> {
    this.ensureStorage();
    const limit = clampLimit(filter.limit);
    const files = readdirSync(AUDIT_DIR)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .reverse();

    const events: AuditEvent[] = [];
    for (const fileName of files) {
      if (events.length >= limit) break;
      const lines = this.readLines(join(AUDIT_DIR, fileName));
      for (const line of lines.reverse()) {
        if (events.length >= limit) break;
        const event = fromJsonLine(line);
        if (!event) continue;
        if (!this.matchesFilter(event, filter)) continue;
        events.push(event);
      }
    }
    return events;
  }

  private matchesFilter(event: AuditEvent, filter: AuditListFilter): boolean {
    if (filter.since !== undefined && event.timestamp < filter.since) return false;
    if (filter.tenantId && event.tenantId !== filter.tenantId) return false;
    if (filter.action) {
      const pattern = filter.action.endsWith("*")
        ? filter.action.slice(0, -1)
        : null;
      if (pattern !== null && !event.action.startsWith(pattern)) return false;
      if (pattern === null && event.action !== filter.action) return false;
    }
    return true;
  }

  private readLines(filePath: string): string[] {
    if (!existsSync(filePath)) return [];
    try {
      return readFileSync(filePath, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  private ensureStorage(): void {
    if (this.storageReady) return;
    mkdirSync(AUDIT_DIR, { recursive: true });
    this.storageReady = true;
  }
}

type PgAuditRow = {
  ts: Date | string;
  action: string;
  tenant_id: string | null;
  route: string | null;
  method: string | null;
  outcome: string;
  api_key_id: string | null;
  details: Record<string, unknown> | null;
  request_id: string | null;
  trace_id: string | null;
};

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE = 50;

class PostgresAuditStore implements AuditStoreBackend {
  private readonly pool: Pool;
  private schemaReady?: Promise<void>;
  private buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });
  }

  async persist(event: AuditEvent): Promise<void> {
    this.buffer.push(event);
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  async list(filter: AuditListFilter): Promise<AuditEvent[]> {
    await this.ensureSchema();
    const params: Array<string | number> = [];
    const conditions: string[] = [];

    if (filter.since !== undefined) {
      params.push(new Date(filter.since).toISOString());
      conditions.push(`ts >= $${params.length}`);
    }
    if (filter.tenantId) {
      params.push(filter.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (filter.action) {
      const isWildcard = filter.action.endsWith("*");
      params.push(isWildcard ? filter.action.slice(0, -1) + "%" : filter.action);
      conditions.push(isWildcard ? `action LIKE $${params.length}` : `action = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = clampLimit(filter.limit);
    const res = await this.pool.query<PgAuditRow>(
      `SELECT ts, action, tenant_id, route, method, outcome, api_key_id, details, request_id, trace_id
       FROM omni_audit_events ${whereClause} ORDER BY ts DESC LIMIT ${limit}`,
      params,
    );

    return res.rows.map((row) => this.rowToEvent(row));
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.buffer.splice(0);
    if (batch.length === 0) return;
    this.writeBatch(batch).catch((err) => {
      console.error("[audit-store] postgres flush error:", err);
    });
  }

  private async writeBatch(events: AuditEvent[]): Promise<void> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of events) {
        await client.query(
          `INSERT INTO omni_audit_events (ts, action, tenant_id, route, method, outcome, api_key_id, details, request_id, trace_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            new Date(event.timestamp).toISOString(),
            event.action,
            event.tenantId ?? null,
            event.route ?? null,
            event.method ?? null,
            event.outcome,
            event.apiKeyId ?? null,
            event.details ? JSON.stringify(event.details) : null,
            event.requestId ?? null,
            event.traceId ?? null,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(`
        CREATE TABLE IF NOT EXISTS omni_audit_events (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          action TEXT NOT NULL,
          tenant_id TEXT,
          route TEXT,
          method TEXT,
          outcome TEXT NOT NULL,
          api_key_id TEXT,
          details JSONB,
          request_id TEXT,
          trace_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_ts ON omni_audit_events(ts);
        CREATE INDEX IF NOT EXISTS idx_audit_tenant ON omni_audit_events(tenant_id);
      `).then(() => undefined);
    }
    await this.schemaReady;
  }

  private rowToEvent(row: PgAuditRow): AuditEvent {
    const ts = row.ts instanceof Date ? row.ts.getTime() : Date.parse(String(row.ts));
    return {
      action: row.action,
      apiKeyId: row.api_key_id ?? undefined,
      details: row.details ?? undefined,
      method: row.method ?? undefined,
      outcome: row.outcome as AuditEvent["outcome"],
      requestId: row.request_id ?? undefined,
      route: row.route ?? undefined,
      tenantId: row.tenant_id ?? undefined,
      timestamp: Number.isFinite(ts) ? ts : Date.now(),
      traceId: row.trace_id ?? undefined,
    };
  }
}

const createAuditStore = (): AuditStoreBackend => {
  const env = getServerEnv();
  if (env.usageStore === "postgres" && env.databaseUrl) {
    return new PostgresAuditStore(env.databaseUrl);
  }
  return new LocalAuditStore();
};

export const auditStore = createAuditStore();
