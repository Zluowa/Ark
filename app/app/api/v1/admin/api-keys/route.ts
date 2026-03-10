import {
  type AuthIdentity,
  authorizeRequest,
  hasAnyScope,
  hasScope,
} from "@/lib/server/access-control";
import {
  apiKeyRegistry,
  type CreateApiKeyInput,
} from "@/lib/server/api-key-registry";
import { withObservedRequest } from "@/lib/server/observability";
import { toResponse } from "@/lib/shared/result";

const parseQuota = (value: unknown): CreateApiKeyInput["quota"] | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const quota = {
    ...(typeof input.burstPerMinute === "number"
      ? { burstPerMinute: input.burstPerMinute }
      : typeof input.burst_per_minute === "number"
        ? { burstPerMinute: input.burst_per_minute }
        : {}),
    ...(typeof input.concurrencyLimit === "number"
      ? { concurrencyLimit: input.concurrencyLimit }
      : typeof input.concurrency_limit === "number"
        ? { concurrencyLimit: input.concurrency_limit }
        : {}),
    ...(typeof input.monthlyLimit === "number"
      ? { monthlyLimit: input.monthlyLimit }
      : typeof input.monthly_limit === "number"
        ? { monthlyLimit: input.monthly_limit }
        : {}),
  };
  return Object.keys(quota).length > 0 ? quota : undefined;
};

const parseCreateBody = async (
  req: Request,
  fallbackTenantId: string,
): Promise<
  | { ok: true; value: CreateApiKeyInput }
  | { ok: false; error: { code: string; message: string; status: number } }
> => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: "Request body must be valid JSON.",
        status: 400,
      },
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error: {
        code: "invalid_body",
        message: "Request body must be a JSON object.",
        status: 400,
      },
    };
  }
  const input = body as Record<string, unknown>;
  const scopes = Array.isArray(input.scopes)
    ? input.scopes.filter((scope): scope is string => typeof scope === "string")
    : typeof input.scopes === "string"
      ? input.scopes
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean)
      : undefined;
  return {
    ok: true,
    value: {
      ...(typeof input.created_by === "string" && input.created_by.trim()
        ? { createdBy: input.created_by.trim() }
        : {}),
      ...(typeof input.id === "string" && input.id.trim()
        ? { id: input.id.trim() }
        : {}),
      ...(typeof input.key === "string" && input.key.trim()
        ? { key: input.key.trim() }
        : {}),
      quota: parseQuota(input.quota),
      scopes,
      tenantId:
        typeof input.tenant_id === "string" && input.tenant_id.trim()
          ? input.tenant_id.trim()
          : fallbackTenantId,
    },
  };
};

const resolveTenantFilter = (req: Request): string | undefined => {
  const url = new URL(req.url);
  return url.searchParams.get("tenant_id")?.trim() || undefined;
};

const canListKeys = (identity: AuthIdentity): boolean =>
  hasAnyScope(identity, ["admin:*", "keys:read"]);

const canCreateKeys = (identity: AuthIdentity): boolean =>
  hasAnyScope(identity, ["admin:*", "keys:write"]);

const isReservedScope = (scope: string): boolean =>
  scope === "admin:*" || scope.startsWith("tenants:");

const validateCreatePermission = (
  identity: Parameters<typeof hasScope>[0],
  input: CreateApiKeyInput,
): { ok: true } | { ok: false; status: number; code: string; message: string } => {
  if (!canCreateKeys(identity)) {
    return {
      ok: false,
      status: 403,
      code: "auth_forbidden_scope",
      message: "Missing required scope: keys:write",
    };
  }
  if (hasScope(identity, "admin:*")) {
    return { ok: true };
  }
  if (input.tenantId !== identity.tenantId) {
    return {
      ok: false,
      status: 403,
      code: "auth_forbidden_scope",
      message: "Tenant bootstrap keys can only manage their own tenant.",
    };
  }
  if ((input.scopes ?? []).some((scope) => isReservedScope(scope.trim().toLowerCase()))) {
    return {
      ok: false,
      status: 403,
      code: "auth_forbidden_scope",
      message: "Tenant bootstrap keys cannot mint admin or tenant-management scopes.",
    };
  }
  return { ok: true };
};

export async function GET(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/api-keys",
    handler: async (observation) => {
      const access = authorizeRequest(req, []);
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      if (!canListKeys(access.identity)) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "auth_forbidden_scope",
              message: "Missing required scope: keys:read",
            },
          },
          { status: 403 },
        );
      }

      const tenantId = resolveTenantFilter(req);
      const effectiveTenantId =
        hasScope(access.identity, "admin:*")
          ? tenantId
          : access.identity.tenantId;
      if (
        tenantId &&
        effectiveTenantId !== tenantId &&
        !hasScope(access.identity, "admin:*")
      ) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "auth_forbidden_scope",
              message: "Tenant bootstrap keys can only view their own tenant keys.",
            },
          },
          { status: 403 },
        );
      }
      const keys = apiKeyRegistry.list({ tenantId: effectiveTenantId });
      return Response.json({
        ok: true,
        keys,
        total: keys.length,
      });
    },
  });
}

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/api-keys",
    handler: async (observation) => {
      const access = authorizeRequest(req, []);
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const parsed = await parseCreateBody(req, access.identity.tenantId);
      if (!parsed.ok) {
        return Response.json(
          {
            ok: false,
            error: parsed.error,
          },
          { status: parsed.error.status },
        );
      }

      const permission = validateCreatePermission(access.identity, parsed.value);
      if (!permission.ok) {
        return Response.json(
          {
            ok: false,
            error: {
              code: permission.code,
              message: permission.message,
            },
          },
          { status: permission.status },
        );
      }

      try {
        const created = apiKeyRegistry.create({
          ...parsed.value,
          createdBy: access.identity.apiKeyId,
        });
        return Response.json(
          {
            ok: true,
            api_key: created.apiKey,
            key: created.summary,
          },
          { status: 201 },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create API key.";
        const status = /already exists/i.test(message) ? 409 : 400;
        return Response.json(
          {
            ok: false,
            error: {
              code:
                status === 409
                  ? "api_key_conflict"
                  : "api_key_create_failed",
              message,
            },
          },
          { status },
        );
      }
    },
  });
}
