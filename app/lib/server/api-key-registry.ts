import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  getServerEnv,
  redactSecret,
  type ApiKeyConfig,
  type ApiKeyQuotaConfig,
} from "@/lib/server/env";
import { tenantRegistry } from "@/lib/server/tenant-registry";

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const CONTROL_PLANE_DIR = join(STORAGE_ROOT, "control-plane");
const API_KEYS_FILE = join(CONTROL_PLANE_DIR, "api-keys.json");

type StoredApiKeyStatus = "active" | "revoked";

type StoredApiKeyRecord = {
  createdAt: number;
  createdBy?: string;
  id: string;
  keyHash: string;
  keyPreview: string;
  quota?: ApiKeyQuotaConfig;
  revokedAt?: number;
  scopes: string[];
  status: StoredApiKeyStatus;
  tenantId: string;
};

export type ApiKeySummary = {
  createdAt?: number;
  createdBy?: string;
  id: string;
  keyPreview: string;
  quota?: ApiKeyQuotaConfig;
  revokedAt?: number;
  revocable: boolean;
  scopes: string[];
  source: "env" | "local";
  status: StoredApiKeyStatus;
  tenantId: string;
};

export type CreateApiKeyInput = {
  createdBy?: string;
  id?: string;
  key?: string;
  quota?: ApiKeyQuotaConfig;
  scopes?: string[];
  tenantId: string;
};

export type CreateApiKeyResult = {
  apiKey: string;
  summary: ApiKeySummary;
};

const normalizeScope = (value: string): string => value.trim().toLowerCase();

const normalizeScopes = (value: string[] | undefined): string[] => {
  const seen = new Set<string>();
  for (const scope of value ?? []) {
    const normalized = normalizeScope(scope);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return Array.from(seen);
};

const sanitizeQuota = (
  quota: ApiKeyQuotaConfig | undefined,
): ApiKeyQuotaConfig | undefined => {
  if (!quota) return undefined;
  const next: ApiKeyQuotaConfig = {};
  if (
    typeof quota.burstPerMinute === "number" &&
    Number.isFinite(quota.burstPerMinute)
  ) {
    next.burstPerMinute = Math.max(0, Math.floor(quota.burstPerMinute));
  }
  if (
    typeof quota.concurrencyLimit === "number" &&
    Number.isFinite(quota.concurrencyLimit)
  ) {
    next.concurrencyLimit = Math.max(0, Math.floor(quota.concurrencyLimit));
  }
  if (
    typeof quota.monthlyLimit === "number" &&
    Number.isFinite(quota.monthlyLimit)
  ) {
    next.monthlyLimit = Math.max(0, Math.floor(quota.monthlyLimit));
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

const hashApiKey = (key: string): string =>
  createHash("sha256").update(key).digest("hex");

const buildPreview = (key: string): string => {
  const normalized = key.trim();
  if (normalized.length <= 12) {
    return redactSecret(normalized) ?? "***";
  }
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStoredRecord = (
  value: unknown,
): StoredApiKeyRecord | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.keyHash !== "string" ||
    typeof value.keyPreview !== "string" ||
    !Array.isArray(value.scopes) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt)
  ) {
    return undefined;
  }
  const status =
    value.status === "revoked" || value.status === "active"
      ? value.status
      : "active";
  const scopes = normalizeScopes(
    value.scopes.filter((scope): scope is string => typeof scope === "string"),
  );
  if (scopes.length === 0) {
    return undefined;
  }
  return {
    createdAt: Math.floor(value.createdAt),
    ...(typeof value.createdBy === "string" && value.createdBy.trim()
      ? { createdBy: value.createdBy.trim() }
      : {}),
    id: value.id.trim(),
    keyHash: value.keyHash.trim(),
    keyPreview: value.keyPreview.trim(),
    quota: sanitizeQuota(value.quota as ApiKeyQuotaConfig | undefined),
    ...(typeof value.revokedAt === "number" && Number.isFinite(value.revokedAt)
      ? { revokedAt: Math.floor(value.revokedAt) }
      : {}),
    scopes,
    status,
    tenantId: value.tenantId.trim(),
  };
};

class LocalApiKeyRegistry {
  private readLocalRecords(): StoredApiKeyRecord[] {
    if (!existsSync(API_KEYS_FILE)) {
      return [];
    }
    try {
      const raw = JSON.parse(readFileSync(API_KEYS_FILE, "utf8")) as unknown;
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw
        .map((record) => parseStoredRecord(record))
        .filter((record): record is StoredApiKeyRecord => Boolean(record));
    } catch {
      return [];
    }
  }

  private writeLocalRecords(records: StoredApiKeyRecord[]): void {
    mkdirSync(CONTROL_PLANE_DIR, { recursive: true });
    const tmp = `${API_KEYS_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
    renameSync(tmp, API_KEYS_FILE);
  }

  private envSummaries(): ApiKeySummary[] {
    return getServerEnv().apiKeys.map((record) => ({
      id: record.id,
      keyPreview: redactSecret(record.key) ?? "***",
      quota: sanitizeQuota(record.quota) ?? tenantRegistry.resolveQuota(record.tenantId),
      revocable: false,
      scopes: normalizeScopes(record.scopes),
      source: "env" as const,
      status: "active" as const,
      tenantId: record.tenantId,
    }));
  }

  private localSummary(record: StoredApiKeyRecord): ApiKeySummary {
    return {
      createdAt: record.createdAt,
      ...(record.createdBy ? { createdBy: record.createdBy } : {}),
      id: record.id,
      keyPreview: record.keyPreview,
      quota: sanitizeQuota(record.quota) ?? tenantRegistry.resolveQuota(record.tenantId),
      ...(record.revokedAt ? { revokedAt: record.revokedAt } : {}),
      revocable: true,
      scopes: record.scopes,
      source: "local",
      status: record.status,
      tenantId: record.tenantId,
    };
  }

  list(options: { tenantId?: string } = {}): ApiKeySummary[] {
    const local = this.readLocalRecords()
      .map((record) => this.localSummary(record))
      .filter((record) =>
        options.tenantId ? record.tenantId === options.tenantId : true,
      );
    const env = this.envSummaries().filter((record) =>
      options.tenantId ? record.tenantId === options.tenantId : true,
    );
    return [...env, ...local].sort((a, b) => {
      const sourceOrder = a.source.localeCompare(b.source);
      if (sourceOrder !== 0) return sourceOrder;
      return a.id.localeCompare(b.id);
    });
  }

  getSummary(id: string): ApiKeySummary | undefined {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return undefined;
    }
    return this.list().find((record) => record.id === normalizedId);
  }

  resolve(apiKey: string): ApiKeyConfig | undefined {
    const envKey = getServerEnv().apiKeys.find((entry) => entry.key === apiKey);
    if (envKey) {
      return envKey;
    }
    const hashed = hashApiKey(apiKey);
    const local = this.readLocalRecords().find(
      (record) => record.status === "active" && record.keyHash === hashed,
    );
    if (!local) {
      return undefined;
    }
    return {
      id: local.id,
      key: apiKey,
      quota: sanitizeQuota(local.quota) ?? tenantRegistry.resolveQuota(local.tenantId),
      scopes: local.scopes,
      tenantId: local.tenantId,
    };
  }

  create(input: CreateApiKeyInput): CreateApiKeyResult {
    const tenantId = input.tenantId.trim();
    if (!tenantId) {
      throw new Error("Tenant id is required.");
    }
    const scopes = normalizeScopes(
      input.scopes && input.scopes.length > 0
        ? input.scopes
        : ["execute:read", "execute:write", "runs:read"],
    );
    if (scopes.length === 0) {
      throw new Error("At least one scope is required.");
    }

    const apiKey =
      input.key?.trim() ||
      `ark_live_local_${randomBytes(24).toString("hex")}`;
    const id = input.id?.trim() || `key_${randomBytes(8).toString("hex")}`;
    const existing = this.list();
    if (existing.some((record) => record.id === id)) {
      throw new Error(`API key id already exists: ${id}`);
    }
    if (this.resolve(apiKey)) {
      throw new Error("API key secret already exists.");
    }

    const createdAt = Date.now();
    const record: StoredApiKeyRecord = {
      createdAt,
      ...(input.createdBy?.trim() ? { createdBy: input.createdBy.trim() } : {}),
      id,
      keyHash: hashApiKey(apiKey),
      keyPreview: buildPreview(apiKey),
      quota: sanitizeQuota(input.quota),
      scopes,
      status: "active",
      tenantId,
    };

    const records = this.readLocalRecords();
    records.push(record);
    this.writeLocalRecords(records);

    return {
      apiKey,
      summary: this.localSummary(record),
    };
  }

  revoke(id: string): ApiKeySummary | undefined {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return undefined;
    }
    if (this.envSummaries().some((record) => record.id === normalizedId)) {
      throw new Error("Environment-managed API keys cannot be revoked through the local control plane.");
    }
    const records = this.readLocalRecords();
    const index = records.findIndex((record) => record.id === normalizedId);
    if (index < 0) {
      return undefined;
    }
    if (records[index].status !== "revoked") {
      records[index] = {
        ...records[index],
        revokedAt: Date.now(),
        status: "revoked",
      };
      this.writeLocalRecords(records);
    }
    return this.localSummary(records[index]);
  }
}

export const apiKeyRegistry = new LocalApiKeyRegistry();
