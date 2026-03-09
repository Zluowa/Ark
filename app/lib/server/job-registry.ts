import { createClient } from "redis";
import { getServerEnv } from "@/lib/server/env";
import {
  toolJobRegistry as localToolJobRegistry,
  type ToolJobOwner,
  type ToolJobRecord,
  type ToolJobStatus,
} from "@/lib/server/tool-job-registry";

type ToolJobRegistryBackend = {
  createQueued: (
    jobId: string,
    tool: string,
    etaMs?: number,
    owner?: ToolJobOwner,
  ) => Promise<ToolJobRecord>;
  get: (jobId: string) => Promise<ToolJobRecord | undefined>;
  listRecent: (limit?: number) => Promise<ToolJobRecord[]>;
  markCompleted: (
    jobId: string,
    result: Record<string, unknown>,
    durationMs: number,
  ) => Promise<ToolJobRecord | undefined>;
  markFailed: (
    jobId: string,
    code: string,
    message: string,
    durationMs?: number,
  ) => Promise<ToolJobRecord | undefined>;
  markProcessing: (
    jobId: string,
    etaMs?: number,
  ) => Promise<ToolJobRecord | undefined>;
};

type RedisClient = ReturnType<typeof createClient>;

const ALLOWED_STATUS = new Set<ToolJobStatus>([
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

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

const toNumber = (
  value: string | number | null | undefined,
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

const safeParseObject = (
  raw: string | undefined,
): Record<string, unknown> | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

type JobErrorPayload = {
  code: string;
  message: string;
};

const safeParseJobError = (
  raw: string | undefined,
): JobErrorPayload | undefined => {
  const parsed = safeParseObject(raw);
  if (!parsed) return undefined;
  if (typeof parsed.code !== "string" || typeof parsed.message !== "string") {
    return undefined;
  }
  return {
    code: parsed.code,
    message: parsed.message,
  };
};

class LocalToolJobRegistryAdapter implements ToolJobRegistryBackend {
  async createQueued(
    jobId: string,
    tool: string,
    etaMs?: number,
    owner?: ToolJobOwner,
  ): Promise<ToolJobRecord> {
    return localToolJobRegistry.createQueued(jobId, tool, etaMs, owner);
  }

  async markProcessing(
    jobId: string,
    etaMs?: number,
  ): Promise<ToolJobRecord | undefined> {
    return localToolJobRegistry.markProcessing(jobId, etaMs);
  }

  async markCompleted(
    jobId: string,
    result: Record<string, unknown>,
    durationMs: number,
  ): Promise<ToolJobRecord | undefined> {
    return localToolJobRegistry.markCompleted(jobId, result, durationMs);
  }

  async markFailed(
    jobId: string,
    code: string,
    message: string,
    durationMs?: number,
  ): Promise<ToolJobRecord | undefined> {
    return localToolJobRegistry.markFailed(jobId, code, message, durationMs);
  }

  async get(jobId: string): Promise<ToolJobRecord | undefined> {
    return localToolJobRegistry.get(jobId);
  }

  async listRecent(limit = 50): Promise<ToolJobRecord[]> {
    return localToolJobRegistry.listRecent(limit);
  }
}

class RedisToolJobRegistry implements ToolJobRegistryBackend {
  private client?: RedisClient;
  private connectPromise?: Promise<RedisClient>;
  private readonly keyPrefix = "omniagent:job";
  private readonly ttlSec = 7 * 24 * 60 * 60;

  constructor(private readonly redisUrl: string) {}

  async createQueued(
    jobId: string,
    tool: string,
    etaMs?: number,
    owner?: ToolJobOwner,
  ): Promise<ToolJobRecord> {
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
    await this.persist(record);
    return record;
  }

  async markProcessing(
    jobId: string,
    etaMs?: number,
  ): Promise<ToolJobRecord | undefined> {
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

  async markCompleted(
    jobId: string,
    result: Record<string, unknown>,
    durationMs: number,
  ): Promise<ToolJobRecord | undefined> {
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

  async markFailed(
    jobId: string,
    code: string,
    message: string,
    durationMs?: number,
  ): Promise<ToolJobRecord | undefined> {
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

  async get(jobId: string): Promise<ToolJobRecord | undefined> {
    const client = await this.getClient();
    const raw = await client.hGetAll(this.jobKey(jobId));
    return this.fromHash(raw);
  }

  async listRecent(limit = 50): Promise<ToolJobRecord[]> {
    const client = await this.getClient();
    const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const jobIds = await client.zRange(this.indexKey(), 0, boundedLimit - 1, {
      REV: true,
    });
    if (jobIds.length === 0) {
      return [];
    }

    const records = await Promise.all(jobIds.map((id) => this.get(id)));
    return records.filter((record): record is ToolJobRecord => Boolean(record));
  }

  private async update(
    jobId: string,
    mutator: (record: ToolJobRecord) => void,
  ): Promise<ToolJobRecord | undefined> {
    const current = await this.get(jobId);
    if (!current) {
      return undefined;
    }
    const next = { ...current };
    mutator(next);
    const sanitized = sanitize(next);
    await this.persist(sanitized);
    return sanitized;
  }

  private async persist(record: ToolJobRecord): Promise<void> {
    const client = await this.getClient();
    const sanitized = sanitize(record);
    const fields = this.toHash(sanitized);
    await client.hSet(this.jobKey(sanitized.jobId), fields);
    await client.expire(this.jobKey(sanitized.jobId), this.ttlSec);
    await client.zAdd(this.indexKey(), [
      { score: sanitized.createdAt, value: sanitized.jobId },
    ]);
    await client.zRemRangeByScore(
      this.indexKey(),
      0,
      Date.now() - this.ttlSec * 1000,
    );
  }

  private async getClient(): Promise<RedisClient> {
    if (this.client) {
      return this.client;
    }
    if (!this.connectPromise) {
      const client = createClient({ url: this.redisUrl });
      client.on("error", (error) => {
        console.error(
          `[job-registry] redis error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      this.connectPromise = client
        .connect()
        .then(() => {
          this.client = client;
          return client;
        })
        .catch((error) => {
          this.connectPromise = undefined;
          throw error;
        });
    }
    const pending = this.connectPromise;
    if (!pending) {
      throw new Error("Redis client connection was not initialized.");
    }
    return pending;
  }

  private toHash(record: ToolJobRecord): Record<string, string> {
    const payload: Record<string, string> = {
      ...(record.apiKeyId ? { apiKeyId: record.apiKeyId } : {}),
      jobId: record.jobId,
      runId: record.runId,
      ...(record.tenantId ? { tenantId: record.tenantId } : {}),
      tool: record.tool,
      status: record.status,
      createdAt: String(record.createdAt),
    };
    if (typeof record.progress === "number") {
      payload.progress = String(clampProgress(record.progress));
    }
    if (typeof record.etaMs === "number") {
      payload.etaMs = String(Math.max(0, Math.floor(record.etaMs)));
    }
    if (typeof record.startedAt === "number") {
      payload.startedAt = String(Math.floor(record.startedAt));
    }
    if (typeof record.completedAt === "number") {
      payload.completedAt = String(Math.floor(record.completedAt));
    }
    if (typeof record.durationMs === "number") {
      payload.durationMs = String(Math.max(1, Math.floor(record.durationMs)));
    }
    if (record.result) {
      payload.result = JSON.stringify(record.result);
    }
    if (record.error) {
      payload.error = JSON.stringify(record.error);
    }
    return payload;
  }

  private fromHash(hash: Record<string, string>): ToolJobRecord | undefined {
    if (Object.keys(hash).length === 0) {
      return undefined;
    }

    const status = hash.status as ToolJobStatus | undefined;
    if (
      typeof hash.jobId !== "string" ||
      typeof hash.runId !== "string" ||
      typeof hash.tool !== "string" ||
      !status ||
      !ALLOWED_STATUS.has(status)
    ) {
      return undefined;
    }

    const createdAt = toNumber(hash.createdAt);
    if (createdAt === undefined) {
      return undefined;
    }

    const parsed = sanitize({
      apiKeyId: hash.apiKeyId,
      jobId: hash.jobId,
      runId: hash.runId,
      tenantId: hash.tenantId,
      tool: hash.tool,
      status,
      progress: toNumber(hash.progress),
      etaMs: toNumber(hash.etaMs),
      result: safeParseObject(hash.result),
      error: safeParseJobError(hash.error),
      createdAt,
      startedAt: toNumber(hash.startedAt),
      completedAt: toNumber(hash.completedAt),
      durationMs: toNumber(hash.durationMs),
    });

    return parsed;
  }

  private jobKey(jobId: string): string {
    return `${this.keyPrefix}:${jobId}`;
  }

  private indexKey(): string {
    return `${this.keyPrefix}:index`;
  }
}

const createJobRegistry = (): ToolJobRegistryBackend => {
  const env = getServerEnv();
  if (env.jobStore === "redis" && env.redisUrl) {
    return new RedisToolJobRegistry(env.redisUrl);
  }
  return new LocalToolJobRegistryAdapter();
};

export const toolJobRegistry = createJobRegistry();
