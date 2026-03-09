// @input: HTTP Request with API key in headers/query, required scopes
// @output: AuthIdentity on success, AppError on failure — typed Result pattern
// @position: auth gate — first check in every API route handler

import { randomUUID } from "node:crypto";
import {
  getServerEnv,
  type ApiKeyConfig,
  type ApiKeyQuotaConfig,
} from "@/lib/server/env";
import { recordAuditEvent } from "@/lib/server/security-controls";
import { type AppError } from "@/lib/shared/result";

export type AccessScope =
  | "execute:read"
  | "execute:write"
  | "runs:read"
  | "admin:*";

export type AuthIdentity = {
  apiKeyId: string;
  quota?: ApiKeyQuotaConfig;
  scopes: Set<string>;
  tenantId: string;
  trustedLocal: boolean;
};

export type OptionalIdentityResult =
  | { ok: true; identity?: AuthIdentity }
  | { ok: false; error: AppError };

export type RequiredIdentityResult =
  | { ok: true; identity: AuthIdentity }
  | { ok: false; error: AppError };

const normalizeScope = (value: string): string => value.trim().toLowerCase();

const resolveRoutePath = (req: Request): string => {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "unknown";
  }
};

const toScopeArray = (
  value: AccessScope | readonly AccessScope[],
): AccessScope[] => {
  if (typeof value === "string") {
    return [value];
  }
  return [...value];
};

const authError = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
): AppError => ({ code, message, status, ...(details !== undefined ? { details } : {}) });

const extractApiKey = (req: Request): string | undefined => {
  const fromHeader = req.headers.get("x-api-key")?.trim();
  if (fromHeader) return fromHeader;

  const authorization = req.headers.get("authorization")?.trim();
  if (authorization) {
    const [scheme, token] = authorization.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token?.trim()) return token.trim();
  }

  if (req.method.toUpperCase() === "GET") {
    return new URL(req.url).searchParams.get("api_key")?.trim() || undefined;
  }
  return undefined;
};

const trustedLocalIdentity = (): AuthIdentity => {
  const env = getServerEnv();
  return {
    apiKeyId: "trusted-local",
    scopes: new Set<AccessScope>([
      "admin:*",
      "execute:read",
      "execute:write",
      "runs:read",
    ]),
    tenantId: env.trustedLocalTenantId,
    trustedLocal: true,
  };
};

const identityFromApiKey = (record: ApiKeyConfig): AuthIdentity => {
  const scopes = new Set(record.scopes.map((scope) => normalizeScope(scope)));
  return {
    apiKeyId: record.id,
    quota: record.quota,
    scopes,
    tenantId: record.tenantId,
    trustedLocal: false,
  };
};

const hasScope = (identity: AuthIdentity, scope: AccessScope): boolean => {
  if (identity.scopes.has("admin:*")) {
    return true;
  }
  return identity.scopes.has(normalizeScope(scope));
};

const hasAllScopes = (
  identity: AuthIdentity,
  requiredScopes: readonly AccessScope[],
): boolean => {
  for (const scope of requiredScopes) {
    if (!hasScope(identity, scope)) {
      return false;
    }
  }
  return true;
};

const resolveApiKeyIdentity = (apiKey: string): AuthIdentity | undefined => {
  const env = getServerEnv();
  const matched = env.apiKeys.find((entry) => entry.key === apiKey);
  if (!matched) {
    return undefined;
  }
  return identityFromApiKey(matched);
};

export const resolveOptionalIdentity = (
  req: Request,
): OptionalIdentityResult => {
  const env = getServerEnv();
  const apiKey = extractApiKey(req);
  const route = resolveRoutePath(req);
  const method = req.method.toUpperCase();
  const requestId = req.headers.get("x-request-id")?.trim() || undefined;
  const traceId = requestId ?? randomUUID().slice(0, 12);

  if (apiKey) {
    const resolved = resolveApiKeyIdentity(apiKey);
    if (!resolved) {
      recordAuditEvent({
        action: "auth.invalid_api_key",
        details: { auth_mode: env.authMode },
        method,
        outcome: "denied",
        requestId,
        route,
        traceId,
      });
      return {
        ok: false,
        error: authError(401, "auth_invalid_credentials", "Invalid API key."),
      };
    }
    recordAuditEvent({
      action: "auth.optional_authorized",
      apiKeyId: resolved.apiKeyId,
      details: { auth_mode: env.authMode },
      method,
      outcome: "allowed",
      requestId,
      route,
      tenantId: resolved.tenantId,
      traceId,
    });
    return { ok: true, identity: resolved };
  }

  if (env.authMode === "trusted_local") {
    const identity = trustedLocalIdentity();
    recordAuditEvent({
      action: "auth.optional_trusted_local",
      apiKeyId: identity.apiKeyId,
      details: { auth_mode: env.authMode },
      method,
      outcome: "allowed",
      requestId,
      route,
      tenantId: identity.tenantId,
      traceId,
    });
    return { ok: true, identity };
  }

  recordAuditEvent({
    action: "auth.optional_anonymous",
    details: { auth_mode: env.authMode },
    method,
    outcome: "allowed",
    requestId,
    route,
    traceId,
  });

  return { ok: true, identity: undefined };
};

export const authorizeRequest = (
  req: Request,
  required: AccessScope | readonly AccessScope[],
): RequiredIdentityResult => {
  const requiredScopes = toScopeArray(required);
  const env = getServerEnv();
  const apiKey = extractApiKey(req);
  const route = resolveRoutePath(req);
  const method = req.method.toUpperCase();
  const requestId = req.headers.get("x-request-id")?.trim() || undefined;
  const traceId = requestId ?? randomUUID().slice(0, 12);

  let identity: AuthIdentity | undefined;
  if (apiKey) {
    identity = resolveApiKeyIdentity(apiKey);
    if (!identity) {
      recordAuditEvent({
        action: "auth.invalid_api_key",
        details: { auth_mode: env.authMode, required_scopes: requiredScopes },
        method,
        outcome: "denied",
        requestId,
        route,
        traceId,
      });
      return {
        ok: false,
        error: authError(401, "auth_invalid_credentials", "Invalid API key."),
      };
    }
  } else if (env.authMode === "trusted_local") {
    identity = trustedLocalIdentity();
  } else {
    recordAuditEvent({
      action: "auth.missing_credentials",
      details: { auth_mode: env.authMode, required_scopes: requiredScopes },
      method,
      outcome: "denied",
      requestId,
      route,
      traceId,
    });
    return {
      ok: false,
      error: authError(
        401,
        "auth_missing_credentials",
        "Missing API key. Provide `X-API-Key` or `Authorization: Bearer <key>`.",
      ),
    };
  }

  if (!hasAllScopes(identity, requiredScopes)) {
    recordAuditEvent({
      action: "auth.missing_scope",
      apiKeyId: identity.apiKeyId,
      details: { required_scopes: requiredScopes },
      method,
      outcome: "denied",
      requestId,
      route,
      tenantId: identity.tenantId,
      traceId,
    });
    return {
      ok: false,
      error: authError(
        403,
        "auth_forbidden_scope",
        `Missing required scope(s): ${requiredScopes.join(", ")}`,
        { required_scopes: requiredScopes },
      ),
    };
  }

  recordAuditEvent({
    action: "auth.authorized",
    apiKeyId: identity.apiKeyId,
    details: { required_scopes: requiredScopes },
    method,
    outcome: "allowed",
    requestId,
    route,
    tenantId: identity.tenantId,
    traceId,
  });

  return { ok: true, identity };
};

export const canAccessTenant = (
  identity: AuthIdentity,
  tenantId: string | undefined,
): boolean => {
  if (hasScope(identity, "admin:*")) {
    return true;
  }
  if (!tenantId) {
    return false;
  }
  return tenantId === identity.tenantId;
};

export const tenantBlockedResponse = (
  resourceType: string,
  resourceId: string,
): Response => {
  return Response.json(
    {
      error: {
        code: "not_found",
        message: `${resourceType} not found: ${resourceId}`,
      },
    },
    { status: 404 },
  );
};
