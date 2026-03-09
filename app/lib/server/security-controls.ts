// @input: HTTP request context, identity from access-control, env config
// @output: enforces rate limits, parses JSON with size limits, records structured audit events
// @position: security middleware layer — wraps every API route for auth + audit + rate-limiting

import { getServerEnv, redactSecret } from "@/lib/server/env";
import { auditStore } from "@/lib/server/audit-store";

export type SecurityIdentity = {
  apiKeyId: string;
  tenantId: string;
  trustedLocal: boolean;
};

export type AuditEventOutcome = "allowed" | "denied" | "error";

export type AuditEvent = {
  action: string;
  apiKeyId?: string;
  details?: Record<string, unknown>;
  method?: string;
  outcome: AuditEventOutcome;
  requestId?: string;
  route?: string;
  tenantId?: string;
  timestamp: number;
  traceId?: string;
};

type JsonParseSuccess<T> = {
  ok: true;
  value: T;
};

type JsonParseFailure = {
  ok: false;
  response: Response;
};

type JsonParseResult<T> = JsonParseSuccess<T> | JsonParseFailure;

type ParseJsonOptions = {
  maxBytes?: number;
  route?: string;
};

type AuditListOptions = {
  action?: string;
  limit?: number;
  outcome?: AuditEventOutcome;
  tenantId?: string;
};

type RateState = {
  timestamps: number[];
  touchedAt: number;
};

const WINDOW_MS = 60_000;
const RATE_STATE_STALE_MS = 6 * WINDOW_MS;
const SENSITIVE_FIELD = /(token|secret|authorization|password|api[_-]?key)/i;

const auditEvents: AuditEvent[] = [];
const routeRateState = new Map<string, RateState>();

const cap = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, Math.floor(value)));
};

const sanitizeAuditDetails = (
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!details) {
    return undefined;
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_FIELD.test(key)) {
      safe[key] =
        typeof value === "string"
          ? (redactSecret(value) ?? "***")
          : value === undefined
            ? undefined
            : "***";
      continue;
    }
    if (typeof value === "string") {
      safe[key] = value.slice(0, 500);
      continue;
    }
    safe[key] = value;
  }
  return safe;
};

const outcomeLevel = (
  outcome: AuditEventOutcome,
): "info" | "warn" | "error" => {
  if (outcome === "error") return "error";
  if (outcome === "denied") return "warn";
  return "info";
};

const logAudit = (event: AuditEvent): void => {
  const level = outcomeLevel(event.outcome);
  const payload = JSON.stringify({
    event: "audit",
    level,
    timestamp: new Date(event.timestamp).toISOString(),
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
  if (level === "error") {
    console.error(payload);
    return;
  }
  if (level === "warn") {
    console.warn(payload);
    return;
  }
  console.log(payload);
};

const pruneAudit = (): void => {
  const env = getServerEnv();
  const max = Math.max(100, env.auditLogMaxEntries);
  if (auditEvents.length > max) {
    auditEvents.splice(0, auditEvents.length - max);
  }
};

const pruneRateState = (): void => {
  const now = Date.now();
  for (const [key, state] of routeRateState.entries()) {
    if (now - state.touchedAt > RATE_STATE_STALE_MS) {
      routeRateState.delete(key);
    }
  }
};

const rateLimitKey = (identity: SecurityIdentity, route: string): string => {
  return `${identity.tenantId}:${identity.apiKeyId}:${route}`;
};

const rateLimitedResponse = (
  retryAfterSec: number,
  route: string,
  limit: number,
): Response => {
  return Response.json(
    {
      ok: false,
      error: {
        code: "rate_limit_exceeded",
        message: `Rate limit exceeded for ${route}.`,
        limit_per_minute: limit,
      },
    },
    {
      headers: {
        "Retry-After": String(cap(retryAfterSec, 1, 60)),
      },
      status: 429,
    },
  );
};

const payloadTooLargeResponse = (
  maxBytes: number,
  route?: string,
): Response => {
  return Response.json(
    {
      ok: false,
      error: {
        code: "payload_too_large",
        message: `Payload exceeds maximum allowed size (${maxBytes} bytes).`,
        max_bytes: maxBytes,
        route,
      },
    },
    { status: 413 },
  );
};

const badJsonResponse = (): Response => {
  return Response.json(
    {
      ok: false,
      error: {
        code: "invalid_json",
        message: "Invalid JSON body.",
      },
    },
    { status: 400 },
  );
};

export const recordAuditEvent = (
  event: Omit<AuditEvent, "timestamp">,
): void => {
  const entry: AuditEvent = {
    ...event,
    details: sanitizeAuditDetails(event.details),
    timestamp: Date.now(),
  };
  auditEvents.push(entry);
  pruneAudit();
  logAudit(entry);
  // fire and forget — persist is async, errors are non-fatal
  void auditStore.persist(entry).catch(() => {});
};

export const listAuditEvents = (
  options: AuditListOptions = {},
): AuditEvent[] => {
  const limit = cap(options.limit ?? 100, 1, 500);
  const action = options.action?.trim();
  const tenantId = options.tenantId?.trim();

  return auditEvents
    .slice()
    .reverse()
    .filter((event) => {
      if (options.outcome && event.outcome !== options.outcome) {
        return false;
      }
      if (action && event.action !== action) {
        return false;
      }
      if (tenantId && event.tenantId !== tenantId) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
};

export const enforceWriteRateLimit = (
  identity: SecurityIdentity,
  route: string,
  requestId?: string,
): Response | undefined => {
  if (identity.trustedLocal) {
    return undefined;
  }
  const env = getServerEnv();
  const limit = cap(env.securityWriteRateLimitPerMinute, 1, 10_000);
  const key = rateLimitKey(identity, route);
  const now = Date.now();
  const state = routeRateState.get(key) ?? {
    timestamps: [],
    touchedAt: now,
  };
  state.touchedAt = now;

  const threshold = now - WINDOW_MS;
  while (state.timestamps.length > 0 && state.timestamps[0] <= threshold) {
    state.timestamps.shift();
  }

  if (state.timestamps.length >= limit) {
    const oldest = state.timestamps[0] ?? now;
    const retryAfterSec = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    routeRateState.set(key, state);
    pruneRateState();
    recordAuditEvent({
      action: "security.rate_limit.blocked",
      apiKeyId: identity.apiKeyId,
      details: {
        limit,
        retry_after_sec: cap(retryAfterSec, 1, 60),
      },
      method: "POST",
      outcome: "denied",
      requestId,
      route,
      tenantId: identity.tenantId,
    });
    return rateLimitedResponse(retryAfterSec, route, limit);
  }

  state.timestamps.push(now);
  routeRateState.set(key, state);
  pruneRateState();
  return undefined;
};

export const enforceMultipartPayloadLimit = (
  req: Request,
  route?: string,
): Response | undefined => {
  const env = getServerEnv();
  const maxBytes = cap(
    env.securityMultipartBodyMaxBytes,
    1024,
    1024 * 1024 * 1024,
  );
  const rawLength = req.headers.get("content-length")?.trim();
  if (!rawLength) {
    return undefined;
  }
  const parsed = Number(rawLength);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (Math.floor(parsed) > maxBytes) {
    return payloadTooLargeResponse(maxBytes, route);
  }
  return undefined;
};

export const parseJsonBodyWithLimit = async <T>(
  req: Request,
  options: ParseJsonOptions = {},
): Promise<JsonParseResult<T>> => {
  const env = getServerEnv();
  const maxBytes = cap(
    options.maxBytes ?? env.securityJsonBodyMaxBytes,
    256,
    16 * 1024 * 1024,
  );
  const contentLength = req.headers.get("content-length")?.trim();
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && Math.floor(parsedLength) > maxBytes) {
      return {
        ok: false,
        response: payloadTooLargeResponse(maxBytes, options.route),
      };
    }
  }

  try {
    const body = (await req.json()) as T;
    return {
      ok: true,
      value: body,
    };
  } catch {
    return {
      ok: false,
      response: badJsonResponse(),
    };
  }
};
