// @input: AuthIdentity with quota config, current tenant execution state
// @output: QuotaReserveResult — ok with lease to release on completion, or error AppError
// @position: quota gate — checked after auth, before tool execution

import { getServerEnv } from "@/lib/server/env";
import { type AuthIdentity } from "@/lib/server/access-control";
import { tenantRegistry } from "@/lib/server/tenant-registry";
import { type AppError } from "@/lib/server/result";

type TenantQuotaState = {
  activeExecutions: number;
  burstAcceptedAt: number[];
  monthlyAccepted: Map<string, number>;
  touchedAt: number;
};

type ResolvedQuotaLimits = {
  burstPerMinute?: number;
  concurrencyLimit?: number;
  monthlyLimit?: number;
};

export type QuotaLease = {
  release: () => void;
};

export type QuotaReserveResult =
  | { ok: true; lease: QuotaLease }
  | { ok: false; error: AppError };

const BURST_WINDOW_MS = 60_000;
const TENANT_STALE_MS = 24 * 60 * 60 * 1000;
const tenantState = new Map<string, TenantQuotaState>();

const toMonthKey = (timestampMs: number): string => {
  const date = new Date(timestampMs);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
};

const normalizeLimit = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value <= 0) {
    return undefined;
  }
  return Math.floor(value);
};

const resolveLimits = (identity: AuthIdentity): ResolvedQuotaLimits => {
  const env = getServerEnv();
  const tenantQuota = tenantRegistry.resolveQuota(identity.tenantId);
  return {
    burstPerMinute: normalizeLimit(
      identity.quota?.burstPerMinute ??
        tenantQuota?.burstPerMinute ??
        env.quotaDefaults.burstPerMinute,
    ),
    concurrencyLimit: normalizeLimit(
      identity.quota?.concurrencyLimit ??
        tenantQuota?.concurrencyLimit ??
        env.quotaDefaults.concurrencyLimit,
    ),
    monthlyLimit: normalizeLimit(
      identity.quota?.monthlyLimit ??
        tenantQuota?.monthlyLimit ??
        env.quotaDefaults.monthlyLimit,
    ),
  };
};

const getTenantState = (tenantId: string): TenantQuotaState => {
  const now = Date.now();
  const cached = tenantState.get(tenantId);
  if (cached) {
    cached.touchedAt = now;
    return cached;
  }

  const created: TenantQuotaState = {
    activeExecutions: 0,
    burstAcceptedAt: [],
    monthlyAccepted: new Map<string, number>(),
    touchedAt: now,
  };
  tenantState.set(tenantId, created);
  return created;
};

const pruneTenantState = (): void => {
  const now = Date.now();
  for (const [tenantId, state] of tenantState.entries()) {
    if (state.activeExecutions > 0) {
      continue;
    }
    if (now - state.touchedAt <= TENANT_STALE_MS) {
      continue;
    }
    tenantState.delete(tenantId);
  }
};

const pruneBurstWindow = (state: TenantQuotaState, now: number): void => {
  const threshold = now - BURST_WINDOW_MS;
  while (
    state.burstAcceptedAt.length > 0 &&
    state.burstAcceptedAt[0] <= threshold
  ) {
    state.burstAcceptedAt.shift();
  }
};

const trimMonthlyBuckets = (
  state: TenantQuotaState,
  activeMonthKey: string,
): void => {
  for (const key of state.monthlyAccepted.keys()) {
    if (key === activeMonthKey) {
      continue;
    }
    state.monthlyAccepted.delete(key);
  }
};

const quotaError = (
  code: string,
  message: string,
  details: Record<string, unknown>,
  retryAfterSec?: number,
): AppError => ({
  code,
  message,
  status: 429,
  details: {
    ...details,
    ...(typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec)
      ? { retry_after_sec: Math.max(1, Math.floor(retryAfterSec)) }
      : {}),
  },
});

export const reserveExecutionQuota = (
  identity: AuthIdentity,
): QuotaReserveResult => {
  if (identity.trustedLocal) {
    return { ok: true, lease: { release: () => {} } };
  }

  const now = Date.now();
  const limits = resolveLimits(identity);
  const state = getTenantState(identity.tenantId);
  const monthKey = toMonthKey(now);

  trimMonthlyBuckets(state, monthKey);
  pruneBurstWindow(state, now);

  const monthlyUsed = state.monthlyAccepted.get(monthKey) ?? 0;
  if (limits.monthlyLimit !== undefined && monthlyUsed >= limits.monthlyLimit) {
    return {
      ok: false,
      error: quotaError(
        "quota_monthly_exhausted",
        "Monthly quota exhausted.",
        { limit: limits.monthlyLimit, reset_month: monthKey, used: monthlyUsed },
      ),
    };
  }

  const burstUsed = state.burstAcceptedAt.length;
  if (limits.burstPerMinute !== undefined && burstUsed >= limits.burstPerMinute) {
    const oldest = state.burstAcceptedAt[0];
    const retryAfterSec = oldest
      ? Math.ceil((oldest + BURST_WINDOW_MS - now) / 1000)
      : 1;
    return {
      ok: false,
      error: quotaError(
        "quota_burst_exhausted",
        "Burst quota exhausted. Retry later.",
        { limit: limits.burstPerMinute, used: burstUsed, window_sec: 60 },
        retryAfterSec,
      ),
    };
  }

  const concurrencyUsed = state.activeExecutions;
  if (
    limits.concurrencyLimit !== undefined &&
    concurrencyUsed >= limits.concurrencyLimit
  ) {
    return {
      ok: false,
      error: quotaError(
        "quota_concurrency_exhausted",
        "Concurrency quota exhausted.",
        { limit: limits.concurrencyLimit, used: concurrencyUsed },
      ),
    };
  }

  state.activeExecutions += 1;
  state.burstAcceptedAt.push(now);
  state.monthlyAccepted.set(monthKey, monthlyUsed + 1);
  state.touchedAt = now;
  pruneTenantState();

  let released = false;
  return {
    ok: true,
    lease: {
      release: () => {
        if (released) return;
        released = true;
        const current = tenantState.get(identity.tenantId);
        if (!current) return;
        current.activeExecutions = Math.max(0, current.activeExecutions - 1);
        current.touchedAt = Date.now();
      },
    },
  };
};
