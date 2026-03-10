import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ApiKeyQuotaConfig } from "@/lib/server/env";

const STORAGE_ROOT =
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
  join(process.cwd(), ".omniagent-state");
const CONTROL_PLANE_DIR = join(STORAGE_ROOT, "control-plane");
const TENANTS_FILE = join(CONTROL_PLANE_DIR, "tenants.json");

export type TenantStatus = "active" | "suspended";

type StoredTenantRecord = {
  createdAt: number;
  createdBy?: string;
  id: string;
  name?: string;
  quota?: ApiKeyQuotaConfig;
  status: TenantStatus;
  updatedAt: number;
};

export type TenantRecord = {
  createdAt: number;
  createdBy?: string;
  id: string;
  name?: string;
  quota?: ApiKeyQuotaConfig;
  status: TenantStatus;
  updatedAt: number;
};

export type CreateTenantInput = {
  createdBy?: string;
  id: string;
  name?: string;
  quota?: ApiKeyQuotaConfig;
};

export type UpdateTenantInput = {
  name?: string;
  quota?: ApiKeyQuotaConfig;
  status?: TenantStatus;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const parseStoredRecord = (value: unknown): TenantRecord | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return undefined;
  }
  const status =
    value.status === "active" || value.status === "suspended"
      ? value.status
      : "active";
  return {
    createdAt: Math.floor(value.createdAt),
    ...(typeof value.createdBy === "string" && value.createdBy.trim()
      ? { createdBy: value.createdBy.trim() }
      : {}),
    id: value.id.trim(),
    ...(typeof value.name === "string" && value.name.trim()
      ? { name: value.name.trim() }
      : {}),
    quota: sanitizeQuota(value.quota as ApiKeyQuotaConfig | undefined),
    status,
    updatedAt: Math.floor(value.updatedAt),
  };
};

class LocalTenantRegistry {
  private readRecords(): TenantRecord[] {
    if (!existsSync(TENANTS_FILE)) {
      return [];
    }
    try {
      const raw = JSON.parse(readFileSync(TENANTS_FILE, "utf8")) as unknown;
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw
        .map((record) => parseStoredRecord(record))
        .filter((record): record is TenantRecord => Boolean(record));
    } catch {
      return [];
    }
  }

  private writeRecords(records: TenantRecord[]): void {
    mkdirSync(CONTROL_PLANE_DIR, { recursive: true });
    const tmp = `${TENANTS_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
    renameSync(tmp, TENANTS_FILE);
  }

  list(): TenantRecord[] {
    return this.readRecords().sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): TenantRecord | undefined {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return undefined;
    }
    return this.readRecords().find((record) => record.id === normalizedId);
  }

  create(input: CreateTenantInput): TenantRecord {
    const id = input.id.trim();
    if (!id) {
      throw new Error("Tenant id is required.");
    }
    const existing = this.get(id);
    if (existing) {
      throw new Error(`Tenant already exists: ${id}`);
    }
    const now = Date.now();
    const record: TenantRecord = {
      createdAt: now,
      ...(input.createdBy?.trim() ? { createdBy: input.createdBy.trim() } : {}),
      id,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      quota: sanitizeQuota(input.quota),
      status: "active",
      updatedAt: now,
    };
    const records = this.readRecords();
    records.push(record);
    this.writeRecords(records);
    return record;
  }

  update(id: string, input: UpdateTenantInput): TenantRecord | undefined {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return undefined;
    }
    const records = this.readRecords();
    const index = records.findIndex((record) => record.id === normalizedId);
    if (index < 0) {
      return undefined;
    }
    const current = records[index];
    const next: TenantRecord = {
      ...current,
      ...(typeof input.name === "string"
        ? { name: input.name.trim() || undefined }
        : {}),
      ...(input.quota !== undefined
        ? { quota: sanitizeQuota(input.quota) }
        : {}),
      ...(input.status ? { status: input.status } : {}),
      updatedAt: Date.now(),
    };
    records[index] = next;
    this.writeRecords(records);
    return next;
  }

  isActive(id: string): boolean {
    const record = this.get(id);
    if (!record) {
      return true;
    }
    return record.status === "active";
  }

  resolveQuota(id: string): ApiKeyQuotaConfig | undefined {
    return this.get(id)?.quota;
  }
}

export const tenantRegistry = new LocalTenantRegistry();
