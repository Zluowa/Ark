// @input: HTTP Request with API key in headers/query, required scopes
// @output: AuthIdentity on success, AppError on failure — typed Result pattern
// @position: auth gate — first check in every API route handler

import { randomUUID } from "node:crypto";
import {
  getServerEnv,
  type ApiKeyConfig,
  type ApiKeyQuotaConfig,
} from "@/lib/server/env";
import { apiKeyRegistry } from "@/lib/server/api-key-registry";
import { recordAuditEvent } from "@/lib/server/security-controls";
import { tenantRegistry } from "@/lib/server/tenant-registry";
import { resolveWebSession } from "@/lib/server/web-auth";
import { type AppError } from "@/lib/shared/result";

export type AccessScope =
  | "keys:read"
  | "keys:write"
  | "tenants:read"
  | "tenants:write"
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

const identityFromWebSession = (
  session: NonNullable<ReturnType<typeof resolveWebSession>>,
): AuthIdentity => {
  const scopes = new Set<string>([
    "execute:read",
    "execute:write",
    "runs:read",
  ]);
  return {
    apiKeyId: `web-session:${session.user.id}`,
    scopes,
    tenantId: session.workspace.tenantId,
    trustedLocal: false,
  };
};

export const hasScope = (identity: AuthIdentity, scope: AccessScope): boolean => {
  if (identity.scopes.has("admin:*")) {
    return true;
  }
  return identity.scopes.has(normalizeScope(scope));
};

export const hasAnyScope = (
  identity: AuthIdentity,
  scopes: readonly AccessScope[],
): boolean => scopes.some((scope) => hasScope(identity, scope));

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
  const matched = apiKeyRegistry.resolve(apiKey);
  if (!matched) {
    return undefined;
  }
  return identityFromApiKey(matched);
};

const tenantSuspendedError = (tenantId: string): AppError =>
  authError(403, "tenant_suspended", `Tenant is suspended: ${tenantId}`);

export const resolveOptionalIdentity = (
  req: Request,
): OptionalIdentityResult => {
  const env = getServerEnv();
  const apiKey = extractApiKey(req);
  const route = resolveRoutePath(req);
  const method = req.method.toUpperCase();
  const requestId = req.headers.get("x-request-id")?.trim() || undefined;
  const traceId = requestId ?? randomUUID().slice(0, 12);

  let apiKeyIdentity: AuthIdentity | undefined;
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
    apiKeyIdentity = resolved;
  }

  const webSession = resolveWebSession(req);
  if (webSession) {
    const identity = identityFromWebSession(webSession);
    recordAuditEvent({
      action: "auth.optional_web_session",
      apiKeyId: identity.apiKeyId,
      details: { auth_mode: env.authMode, workspace_id: webSession.workspace.id },
      method,
      outcome: "allowed",
      requestId,
      route,
      tenantId: identity.tenantId,
      traceId,
    });
    if (!tenantRegistry.isActive(identity.tenantId)) {
      return {
        ok: false,
        error: tenantSuspendedError(identity.tenantId),
      };
    }
    return { ok: true, identity };
  }

  if (apiKeyIdentity) {
    recordAuditEvent({
      action: "auth.optional_authorized",
      apiKeyId: apiKeyIdentity.apiKeyId,
      details: { auth_mode: env.authMode },
      method,
      outcome: "allowed",
      requestId,
      route,
      tenantId: apiKeyIdentity.tenantId,
      traceId,
    });
    if (
      !apiKeyIdentity.trustedLocal &&
      !tenantRegistry.isActive(apiKeyIdentity.tenantId)
    ) {
      return {
        ok: false,
        error: tenantSuspendedError(apiKeyIdentity.tenantId),
      };
    }
    return { ok: true, identity: apiKeyIdentity };
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
  }

  const webSession = resolveWebSession(req);
  if (webSession) {
    identity = identityFromWebSession(webSession);
  } else if (!identity && env.authMode === "trusted_local") {
    identity = trustedLocalIdentity();
  }

  if (!identity) {
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
        "Missing API key or browser session.",
      ),
    };
  }

  if (!hasAllScopes(identity, requiredScopes)) {
    recordAuditEvent({
      action: identity.apiKeyId.startsWith("web-session:")
        ? "auth.web_session_missing_scope"
        : "auth.missing_scope",
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

  if (!identity.trustedLocal && !tenantRegistry.isActive(identity.tenantId)) {
    recordAuditEvent({
      action: "auth.tenant_suspended",
      apiKeyId: identity.apiKeyId,
      details: { tenant_id: identity.tenantId },
      method,
      outcome: "denied",
      requestId,
      route,
      tenantId: identity.tenantId,
      traceId,
    });
    return {
      ok: false,
      error: tenantSuspendedError(identity.tenantId),
    };
  }

  recordAuditEvent({
    action: identity.apiKeyId.startsWith("web-session:")
      ? "auth.web_session_authorized"
      : "auth.authorized",
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
