import { authorizeRequest } from "@/lib/server/access-control";
import { apiKeyRegistry } from "@/lib/server/api-key-registry";
import { getServerEnv } from "@/lib/server/env";
import { withObservedRequest } from "@/lib/server/observability";
import { tenantRegistry, type CreateTenantInput } from "@/lib/server/tenant-registry";
import { toResponse } from "@/lib/shared/result";

const serviceModeDisabledResponse = () =>
  Response.json(
    {
      ok: false,
      error: {
        code: "service_mode_disabled",
        message:
          "Managed tenant issuance requires OMNIAGENT_SERVICE_MODE=managed_ark_key.",
      },
    },
    { status: 409 },
  );

const parseQuota = (value: unknown): CreateTenantInput["quota"] | undefined => {
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

const parseScopes = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
};

const parseCreateBody = async (
  req: Request,
): Promise<
  | {
      ok: true;
      value: CreateTenantInput & {
        tenantKeyId?: string;
        tenantKeyScopes?: string[];
      };
    }
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
  if (typeof input.id !== "string" || !input.id.trim()) {
    return {
      ok: false,
      error: {
        code: "invalid_tenant_id",
        message: "Tenant id is required.",
        status: 400,
      },
    };
  }
  const tenantKeyScopes = parseScopes(input.tenant_key_scopes);
  return {
    ok: true,
    value: {
      id: input.id.trim(),
      ...(typeof input.name === "string" && input.name.trim()
        ? { name: input.name.trim() }
        : {}),
      quota: parseQuota(input.quota),
      ...(typeof input.tenant_key_id === "string" && input.tenant_key_id.trim()
        ? { tenantKeyId: input.tenant_key_id.trim() }
        : {}),
      ...(tenantKeyScopes ? { tenantKeyScopes } : {}),
    },
  };
};

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/managed-tenants",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const env = getServerEnv();
      if (env.serviceMode !== "managed_ark_key") {
        return serviceModeDisabledResponse();
      }

      const parsed = await parseCreateBody(req);
      if (!parsed.ok) {
        return Response.json(
          {
            ok: false,
            error: parsed.error,
          },
          { status: parsed.error.status },
        );
      }

      try {
        const tenant = tenantRegistry.create({
          id: parsed.value.id,
          name: parsed.value.name,
          quota: parsed.value.quota,
          createdBy: access.identity.apiKeyId,
        });
        const tenantKey = apiKeyRegistry.create({
          createdBy: access.identity.apiKeyId,
          id: parsed.value.tenantKeyId ?? `${tenant.id}-ark`,
          scopes:
            parsed.value.tenantKeyScopes ?? [
              "execute:read",
              "execute:write",
              "runs:read",
            ],
          tenantId: tenant.id,
        });
        return Response.json(
          {
            ok: true,
            tenant,
            tenant_api_key: tenantKey.apiKey,
            tenant_key: tenantKey.summary,
            service_mode: env.serviceMode,
          },
          { status: 201 },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create managed tenant.";
        const status = /already exists/i.test(message) ? 409 : 400;
        return Response.json(
          {
            ok: false,
            error: {
              code:
                status === 409
                  ? "managed_tenant_conflict"
                  : "managed_tenant_create_failed",
              message,
            },
          },
          { status },
        );
      }
    },
  });
}

export async function GET(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/managed-tenants",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const env = getServerEnv();
      if (env.serviceMode !== "managed_ark_key") {
        return serviceModeDisabledResponse();
      }

      const tenants = tenantRegistry.list().map((tenant) => {
        const tenantKeys = apiKeyRegistry.list({ tenantId: tenant.id });
        return {
          tenant,
          active_key_count: tenantKeys.filter((key) => key.status === "active")
            .length,
          total_key_count: tenantKeys.length,
        };
      });

      return Response.json({
        ok: true,
        service_mode: env.serviceMode,
        tenants,
        total: tenants.length,
      });
    },
  });
}
