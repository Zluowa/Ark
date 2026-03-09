import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { getServerEnv } from "@/lib/server/env";

export type UsageStatus = "succeeded" | "failed" | "cancelled";

export type UsageRecord = {
  apiKeyId: string;
  createdAt: number;
  creditsUsed: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  id: string;
  jobId?: string;
  runId: string;
  source: string;
  status: UsageStatus;
  tenantId: string;
  tool: string;
};

export type UsageWriteInput = {
  apiKeyId: string;
  createdAt?: number;
  creditsUsed: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  id?: string;
  jobId?: string;
  runId: string;
  source: string;
  status: UsageStatus;
  tenantId: string;
  tool: string;
};

export type UsageListFilter = {
  limit?: number;
  runId?: string;
  tenantId?: string;
};

export type UsageSummaryBucket = {
  cancelledRuns: number;
  failedRuns: number;
  from: number;
  succeededRuns: number;
  to: number;
  totalCredits: number;
  totalRuns: number;
};

export type UsageSummary = {
  asOf: number;
  day: UsageSummaryBucket;
  month: UsageSummaryBucket;
  tenantId: string;
};

type UsageLedgerBackend = {
  append: (input: UsageWriteInput) => Promise<UsageRecord>;
  listRecent: (filter?: UsageListFilter) => Promise<UsageRecord[]>;
  summarize: (tenantId: string, now?: number) => Promise<UsageSummary>;
};

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const USAGE_DIR = join(STORAGE_ROOT, "usage");

const toUtcDayStart = (timestampMs: number): number => {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const toUtcMonthStart = (timestampMs: number): number => {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};

const toUtcMonthEnd = (timestampMs: number): number => {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
};

const nextUtcDayStart = (timestampMs: number): number => {
  return toUtcDayStart(timestampMs) + 24 * 60 * 60 * 1000;
};

const createBucket = (from: number, to: number): UsageSummaryBucket => {
  return {
    cancelledRuns: 0,
    failedRuns: 0,
    from,
    succeededRuns: 0,
    to,
    totalCredits: 0,
    totalRuns: 0,
  };
};

const sanitizeStatus = (value: string): UsageStatus | undefined => {
  if (value === "succeeded" || value === "failed" || value === "cancelled") {
    return value;
  }
  return undefined;
};

const sanitizeNumber = (
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

const clampLimit = (value: number | undefined, fallback = 50): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(500, Math.floor(value)));
};

const normalizeRecord = (input: UsageWriteInput): UsageRecord => {
  return {
    apiKeyId: input.apiKeyId.trim() || "unknown",
    createdAt:
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? Math.max(0, Math.floor(input.createdAt))
        : Date.now(),
    creditsUsed: Math.max(0, Math.floor(input.creditsUsed)),
    durationMs:
      typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
        ? Math.max(1, Math.floor(input.durationMs))
        : undefined,
    errorCode: input.errorCode?.trim() || undefined,
    errorMessage: input.errorMessage?.trim() || undefined,
    id: input.id?.trim() || randomUUID(),
    jobId: input.jobId?.trim() || undefined,
    runId: input.runId.trim(),
    source: input.source.trim() || "unknown",
    status: input.status,
    tenantId: input.tenantId.trim() || "default",
    tool: input.tool.trim() || "unknown",
  };
};

const applyToBucket = (
  bucket: UsageSummaryBucket,
  record: UsageRecord,
  from: number,
  to: number,
): void => {
  if (record.createdAt < from || record.createdAt >= to) {
    return;
  }
  bucket.totalRuns += 1;
  bucket.totalCredits += record.creditsUsed;
  if (record.status === "succeeded") {
    bucket.succeededRuns += 1;
    return;
  }
  if (record.status === "failed") {
    bucket.failedRuns += 1;
    return;
  }
  bucket.cancelledRuns += 1;
};

const toUsageRecord = (value: unknown): UsageRecord | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Partial<UsageRecord>;
  const status =
    typeof raw.status === "string" ? sanitizeStatus(raw.status) : undefined;
  const createdAt = sanitizeNumber(raw.createdAt);
  const creditsUsed = sanitizeNumber(raw.creditsUsed);

  if (
    !status ||
    typeof raw.id !== "string" ||
    typeof raw.runId !== "string" ||
    typeof raw.tenantId !== "string" ||
    typeof raw.apiKeyId !== "string" ||
    typeof raw.source !== "string" ||
    typeof raw.tool !== "string" ||
    createdAt === undefined ||
    creditsUsed === undefined
  ) {
    return undefined;
  }

  return {
    apiKeyId: raw.apiKeyId,
    createdAt: Math.max(0, Math.floor(createdAt)),
    creditsUsed: Math.max(0, Math.floor(creditsUsed)),
    durationMs: sanitizeNumber(raw.durationMs),
    errorCode: typeof raw.errorCode === "string" ? raw.errorCode : undefined,
    errorMessage:
      typeof raw.errorMessage === "string" ? raw.errorMessage : undefined,
    id: raw.id,
    jobId: typeof raw.jobId === "string" ? raw.jobId : undefined,
    runId: raw.runId,
    source: raw.source,
    status,
    tenantId: raw.tenantId,
    tool: raw.tool,
  };
};

const makeSummaryFromRecords = (
  tenantId: string,
  records: readonly UsageRecord[],
  now = Date.now(),
): UsageSummary => {
  const dayFrom = toUtcDayStart(now);
  const dayTo = nextUtcDayStart(now);
  const monthFrom = toUtcMonthStart(now);
  const monthTo = toUtcMonthEnd(now);
  const day = createBucket(dayFrom, dayTo);
  const month = createBucket(monthFrom, monthTo);

  for (const record of records) {
    if (record.tenantId !== tenantId) {
      continue;
    }
    applyToBucket(day, record, dayFrom, dayTo);
    applyToBucket(month, record, monthFrom, monthTo);
  }

  return {
    asOf: now,
    day,
    month,
    tenantId,
  };
};

class LocalUsageLedger implements UsageLedgerBackend {
  private storageReady = false;

  async append(input: UsageWriteInput): Promise<UsageRecord> {
    const record = normalizeRecord(input);
    this.persist(record);
    return record;
  }

  async listRecent(filter: UsageListFilter = {}): Promise<UsageRecord[]> {
    this.ensureStorage();
    const files = readdirSync(USAGE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(USAGE_DIR, name));
    const records: UsageRecord[] = [];
    for (const filePath of files) {
      const parsed = this.readRecord(filePath);
      if (!parsed) {
        continue;
      }
      records.push(parsed);
    }

    const filtered = records
      .filter((record) => {
        if (filter.tenantId && record.tenantId !== filter.tenantId) {
          return false;
        }
        if (filter.runId && record.runId !== filter.runId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    return filtered.slice(0, clampLimit(filter.limit));
  }

  async summarize(tenantId: string, now = Date.now()): Promise<UsageSummary> {
    const all = await this.listRecent({ limit: 5000, tenantId });
    return makeSummaryFromRecords(tenantId, all, now);
  }

  private persist(record: UsageRecord): void {
    this.ensureStorage();
    const finalPath = this.recordPath(record.id);
    const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(record), "utf8");
    renameSync(tempPath, finalPath);
  }

  private readRecord(filePath: string): UsageRecord | undefined {
    if (!existsSync(filePath)) return undefined;
    try {
      const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
      return toUsageRecord(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  private recordPath(id: string): string {
    return join(USAGE_DIR, `${id}.json`);
  }

  private ensureStorage(): void {
    if (this.storageReady) return;
    mkdirSync(USAGE_DIR, { recursive: true });
    this.storageReady = true;
  }
}

type PgUsageRow = {
  api_key_id: string;
  created_at: number | string;
  credits_used: number | string;
  duration_ms: number | string | null;
  error_code: string | null;
  error_message: string | null;
  id: string;
  job_id: string | null;
  run_id: string;
  source: string;
  status: UsageStatus;
  tenant_id: string;
  tool: string;
};

class PostgresUsageLedger implements UsageLedgerBackend {
  private readonly pool: Pool;
  private schemaReady?: Promise<void>;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });
  }

  async append(input: UsageWriteInput): Promise<UsageRecord> {
    const record = normalizeRecord(input);
    await this.withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO omni_usage_ledger (
            id, run_id, job_id, tenant_id, api_key_id, tool, source, status,
            duration_ms, credits_used, error_code, error_message, created_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13
          )
        `,
        [
          record.id,
          record.runId,
          record.jobId ?? null,
          record.tenantId,
          record.apiKeyId,
          record.tool,
          record.source,
          record.status,
          record.durationMs ?? null,
          record.creditsUsed,
          record.errorCode ?? null,
          record.errorMessage ?? null,
          record.createdAt,
        ],
      );
    });
    return record;
  }

  async listRecent(filter: UsageListFilter = {}): Promise<UsageRecord[]> {
    await this.ensureSchema();
    const params: Array<string | number> = [];
    const conditions: string[] = [];
    if (filter.tenantId) {
      params.push(filter.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (filter.runId) {
      params.push(filter.runId);
      conditions.push(`run_id = $${params.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = clampLimit(filter.limit);
    const res = await this.pool.query<PgUsageRow>(
      `
        SELECT
          id, run_id, job_id, tenant_id, api_key_id, tool, source, status,
          duration_ms, credits_used, error_code, error_message, created_at
        FROM omni_usage_ledger
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `,
      params,
    );
    return res.rows.map((row) => this.rowToRecord(row)).filter(Boolean);
  }

  async summarize(tenantId: string, now = Date.now()): Promise<UsageSummary> {
    await this.ensureSchema();
    const dayFrom = toUtcDayStart(now);
    const dayTo = nextUtcDayStart(now);
    const monthFrom = toUtcMonthStart(now);
    const monthTo = toUtcMonthEnd(now);

    const res = await this.pool.query<Record<string, number | string>>(
      `
        SELECT
          COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $3 THEN credits_used ELSE 0 END), 0) AS day_credits,
          COALESCE(SUM(CASE WHEN created_at >= $4 AND created_at < $5 THEN credits_used ELSE 0 END), 0) AS month_credits,
          COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $3 THEN 1 ELSE 0 END), 0) AS day_runs,
          COALESCE(SUM(CASE WHEN created_at >= $4 AND created_at < $5 THEN 1 ELSE 0 END), 0) AS month_runs,
          COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $3 AND status = 'succeeded' THEN 1 ELSE 0 END), 0) AS day_succeeded,
          COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $3 AND status = 'failed' THEN 1 ELSE 0 END), 0) AS day_failed,
          COALESCE(SUM(CASE WHEN created_at >= $2 AND created_at < $3 AND status = 'cancelled' THEN 1 ELSE 0 END), 0) AS day_cancelled,
          COALESCE(SUM(CASE WHEN created_at >= $4 AND created_at < $5 AND status = 'succeeded' THEN 1 ELSE 0 END), 0) AS month_succeeded,
          COALESCE(SUM(CASE WHEN created_at >= $4 AND created_at < $5 AND status = 'failed' THEN 1 ELSE 0 END), 0) AS month_failed,
          COALESCE(SUM(CASE WHEN created_at >= $4 AND created_at < $5 AND status = 'cancelled' THEN 1 ELSE 0 END), 0) AS month_cancelled
        FROM omni_usage_ledger
        WHERE tenant_id = $1
      `,
      [tenantId, dayFrom, dayTo, monthFrom, monthTo],
    );

    const row = res.rows[0] ?? {};
    return {
      asOf: now,
      day: {
        cancelledRuns: Math.max(
          0,
          Math.floor(sanitizeNumber(row.day_cancelled) ?? 0),
        ),
        failedRuns: Math.max(
          0,
          Math.floor(sanitizeNumber(row.day_failed) ?? 0),
        ),
        from: dayFrom,
        succeededRuns: Math.max(
          0,
          Math.floor(sanitizeNumber(row.day_succeeded) ?? 0),
        ),
        to: dayTo,
        totalCredits: Math.max(
          0,
          Math.floor(sanitizeNumber(row.day_credits) ?? 0),
        ),
        totalRuns: Math.max(0, Math.floor(sanitizeNumber(row.day_runs) ?? 0)),
      },
      month: {
        cancelledRuns: Math.max(
          0,
          Math.floor(sanitizeNumber(row.month_cancelled) ?? 0),
        ),
        failedRuns: Math.max(
          0,
          Math.floor(sanitizeNumber(row.month_failed) ?? 0),
        ),
        from: monthFrom,
        succeededRuns: Math.max(
          0,
          Math.floor(sanitizeNumber(row.month_succeeded) ?? 0),
        ),
        to: monthTo,
        totalCredits: Math.max(
          0,
          Math.floor(sanitizeNumber(row.month_credits) ?? 0),
        ),
        totalRuns: Math.max(0, Math.floor(sanitizeNumber(row.month_runs) ?? 0)),
      },
      tenantId,
    };
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool
        .query(`
          CREATE TABLE IF NOT EXISTS omni_usage_ledger (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            job_id TEXT,
            tenant_id TEXT NOT NULL,
            api_key_id TEXT NOT NULL,
            tool TEXT NOT NULL,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            duration_ms INTEGER,
            credits_used INTEGER NOT NULL,
            error_code TEXT,
            error_message TEXT,
            created_at BIGINT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_omni_usage_ledger_tenant_created
            ON omni_usage_ledger (tenant_id, created_at DESC);

          CREATE INDEX IF NOT EXISTS idx_omni_usage_ledger_run_id
            ON omni_usage_ledger (run_id);
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

  private rowToRecord(row: PgUsageRow): UsageRecord {
    return {
      apiKeyId: row.api_key_id,
      createdAt: Math.max(0, Math.floor(sanitizeNumber(row.created_at) ?? 0)),
      creditsUsed: Math.max(
        0,
        Math.floor(sanitizeNumber(row.credits_used) ?? 0),
      ),
      durationMs: sanitizeNumber(row.duration_ms),
      errorCode: row.error_code ?? undefined,
      errorMessage: row.error_message ?? undefined,
      id: row.id,
      jobId: row.job_id ?? undefined,
      runId: row.run_id,
      source: row.source,
      status: row.status,
      tenantId: row.tenant_id,
      tool: row.tool,
    };
  }
}

const createUsageLedger = (): UsageLedgerBackend => {
  const env = getServerEnv();
  if (env.usageStore === "postgres" && env.databaseUrl) {
    return new PostgresUsageLedger(env.databaseUrl);
  }
  return new LocalUsageLedger();
};

export const usageLedger = createUsageLedger();
