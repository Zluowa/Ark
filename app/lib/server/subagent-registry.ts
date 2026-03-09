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

export type SubagentRecord = {
  apiKeyId: string;
  createdAt: number;
  effectiveScopes: string[];
  id: string;
  runId: string;
  spawnedBy?: string;
  spawnDepth: number;
  tenantId: string;
  tool: string;
};

export type SubagentCreateInput = {
  apiKeyId: string;
  effectiveScopes: string[];
  id?: string;
  runId: string;
  spawnedBy?: string;
  spawnDepth: number;
  tenantId: string;
  tool: string;
};

export type SubagentListFilter = {
  limit?: number;
  tenantId?: string;
};

type SubagentRegistryBackend = {
  create: (input: SubagentCreateInput) => Promise<SubagentRecord>;
  get: (id: string) => Promise<SubagentRecord | undefined>;
  listRecent: (filter?: SubagentListFilter) => Promise<SubagentRecord[]>;
};

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const SUBAGENTS_DIR = join(STORAGE_ROOT, "subagents");

const clampLimit = (value: number | undefined, fallback = 50): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(500, Math.floor(value)));
};

const normalizeScopes = (scopes: readonly string[]): string[] => {
  const dedup = new Set<string>();
  for (const scope of scopes) {
    const normalized = scope.trim().toLowerCase();
    if (!normalized) continue;
    dedup.add(normalized);
  }
  return [...dedup];
};

const toSubagentRecord = (value: unknown): SubagentRecord | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Partial<SubagentRecord>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.runId !== "string" ||
    typeof raw.tenantId !== "string" ||
    typeof raw.apiKeyId !== "string" ||
    typeof raw.tool !== "string" ||
    typeof raw.createdAt !== "number" ||
    typeof raw.spawnDepth !== "number" ||
    !Array.isArray(raw.effectiveScopes)
  ) {
    return undefined;
  }

  return {
    apiKeyId: raw.apiKeyId,
    createdAt: Math.max(0, Math.floor(raw.createdAt)),
    effectiveScopes: normalizeScopes(
      raw.effectiveScopes.filter(
        (item): item is string => typeof item === "string",
      ),
    ),
    id: raw.id,
    runId: raw.runId,
    spawnedBy: typeof raw.spawnedBy === "string" ? raw.spawnedBy : undefined,
    spawnDepth: Math.max(0, Math.floor(raw.spawnDepth)),
    tenantId: raw.tenantId,
    tool: raw.tool,
  };
};

const normalizeInput = (input: SubagentCreateInput): SubagentRecord => {
  return {
    apiKeyId: input.apiKeyId.trim() || "unknown",
    createdAt: Date.now(),
    effectiveScopes: normalizeScopes(input.effectiveScopes),
    id: input.id?.trim() || randomUUID(),
    runId: input.runId.trim(),
    spawnedBy: input.spawnedBy?.trim() || undefined,
    spawnDepth: Math.max(0, Math.floor(input.spawnDepth)),
    tenantId: input.tenantId.trim() || "default",
    tool: input.tool.trim() || "unknown",
  };
};

class LocalSubagentRegistry implements SubagentRegistryBackend {
  private storageReady = false;

  async create(input: SubagentCreateInput): Promise<SubagentRecord> {
    const record = normalizeInput(input);
    const existing = await this.get(record.id);
    if (existing) {
      throw new Error(`Subagent already exists: ${record.id}`);
    }
    this.persist(record);
    return record;
  }

  async get(id: string): Promise<SubagentRecord | undefined> {
    this.ensureStorage();
    const filePath = this.recordPath(id);
    if (!existsSync(filePath)) {
      return undefined;
    }
    try {
      const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
      return toSubagentRecord(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  async listRecent(filter: SubagentListFilter = {}): Promise<SubagentRecord[]> {
    this.ensureStorage();
    const items: SubagentRecord[] = [];
    const files = readdirSync(SUBAGENTS_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(SUBAGENTS_DIR, name));
    for (const filePath of files) {
      try {
        const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
        const parsed = toSubagentRecord(JSON.parse(raw));
        if (!parsed) continue;
        if (filter.tenantId && parsed.tenantId !== filter.tenantId) continue;
        items.push(parsed);
      } catch {
        // Skip malformed records.
      }
    }
    return items
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, clampLimit(filter.limit));
  }

  private persist(record: SubagentRecord): void {
    this.ensureStorage();
    const finalPath = this.recordPath(record.id);
    const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(record), "utf8");
    renameSync(tempPath, finalPath);
  }

  private recordPath(id: string): string {
    return join(SUBAGENTS_DIR, `${id}.json`);
  }

  private ensureStorage(): void {
    if (this.storageReady) return;
    mkdirSync(SUBAGENTS_DIR, { recursive: true });
    this.storageReady = true;
  }
}

type PgSubagentRow = {
  api_key_id: string;
  created_at: number | string;
  effective_scopes: string;
  id: string;
  run_id: string;
  spawned_by: string | null;
  spawn_depth: number | string;
  tenant_id: string;
  tool: string;
};

class PostgresSubagentRegistry implements SubagentRegistryBackend {
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

  async create(input: SubagentCreateInput): Promise<SubagentRecord> {
    const record = normalizeInput(input);
    await this.withTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO omni_subagents (
            id, run_id, tenant_id, api_key_id, tool,
            spawned_by, spawn_depth, effective_scopes, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          record.id,
          record.runId,
          record.tenantId,
          record.apiKeyId,
          record.tool,
          record.spawnedBy ?? null,
          record.spawnDepth,
          JSON.stringify(record.effectiveScopes),
          record.createdAt,
        ],
      );
    });
    return record;
  }

  async get(id: string): Promise<SubagentRecord | undefined> {
    await this.ensureSchema();
    const res = await this.pool.query<PgSubagentRow>(
      `
        SELECT id, run_id, tenant_id, api_key_id, tool,
               spawned_by, spawn_depth, effective_scopes, created_at
        FROM omni_subagents
        WHERE id = $1
      `,
      [id],
    );
    if ((res.rowCount ?? 0) < 1) {
      return undefined;
    }
    return this.rowToRecord(res.rows[0]);
  }

  async listRecent(filter: SubagentListFilter = {}): Promise<SubagentRecord[]> {
    await this.ensureSchema();
    const params: Array<string | number> = [];
    const conditions: string[] = [];
    if (filter.tenantId) {
      params.push(filter.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = clampLimit(filter.limit);
    const res = await this.pool.query<PgSubagentRow>(
      `
        SELECT id, run_id, tenant_id, api_key_id, tool,
               spawned_by, spawn_depth, effective_scopes, created_at
        FROM omni_subagents
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `,
      params,
    );
    return res.rows.map((row) => this.rowToRecord(row));
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool
        .query(`
          CREATE TABLE IF NOT EXISTS omni_subagents (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            api_key_id TEXT NOT NULL,
            tool TEXT NOT NULL,
            spawned_by TEXT,
            spawn_depth INTEGER NOT NULL DEFAULT 0,
            effective_scopes TEXT NOT NULL,
            created_at BIGINT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_omni_subagents_tenant_created
            ON omni_subagents (tenant_id, created_at DESC);

          CREATE INDEX IF NOT EXISTS idx_omni_subagents_run_id
            ON omni_subagents (run_id);
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

  private rowToRecord(row: PgSubagentRow): SubagentRecord {
    let scopes: string[] = [];
    try {
      const parsed = JSON.parse(row.effective_scopes) as unknown;
      if (Array.isArray(parsed)) {
        scopes = normalizeScopes(
          parsed.filter((item): item is string => typeof item === "string"),
        );
      }
    } catch {
      scopes = [];
    }

    return {
      apiKeyId: row.api_key_id,
      createdAt: Math.max(0, Math.floor(Number(row.created_at))),
      effectiveScopes: scopes,
      id: row.id,
      runId: row.run_id,
      spawnedBy: row.spawned_by ?? undefined,
      spawnDepth: Math.max(0, Math.floor(Number(row.spawn_depth))),
      tenantId: row.tenant_id,
      tool: row.tool,
    };
  }
}

const createSubagentRegistry = (): SubagentRegistryBackend => {
  const env = getServerEnv();
  if (env.runStore === "postgres" && env.databaseUrl) {
    return new PostgresSubagentRegistry(env.databaseUrl);
  }
  return new LocalSubagentRegistry();
};

export const subagentRegistry = createSubagentRegistry();
