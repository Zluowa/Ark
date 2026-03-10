import { authorizeRequest } from "@/lib/server/access-control";
import { apiKeyRegistry } from "@/lib/server/api-key-registry";
import {
  tenantRegistry,
  type CreateTenantInput,
} from "@/lib/server/tenant-registry";
import { withObservedRequest } from "@/lib/server/observability";
import { toResponse } from "@/lib/shared/result";

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

const parseCreateBody = async (
  req: Request,
): Promise<
  | { ok: true; value: CreateTenantInput }
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
  return {
    ok: true,
    value: {
      id: input.id.trim(),
      ...(typeof input.name === "string" && input.name.trim()
        ? { name: input.name.trim() }
        : {}),
      quota: parseQuota(input.quota),
    },
  };
};

export async function GET(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/tenants",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const tenants = tenantRegistry.list();
      return Response.json({
        ok: true,
        tenants,
        total: tenants.length,
      });
    },
  });
}

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/tenants",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

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
          ...parsed.value,
          createdBy: access.identity.apiKeyId,
        });
        const bootstrap = apiKeyRegistry.create({
          createdBy: access.identity.apiKeyId,
          id: `${tenant.id}-bootstrap`,
          scopes: ["keys:read", "keys:write", "execute:read", "execute:write", "runs:read"],
          tenantId: tenant.id,
        });
        return Response.json(
          {
            ok: true,
            tenant,
            bootstrap_api_key: bootstrap.apiKey,
            bootstrap_key: bootstrap.summary,
          },
          { status: 201 },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to create tenant.";
        const status = /already exists/i.test(message) ? 409 : 400;
        return Response.json(
          {
            ok: false,
            error: {
              code: status === 409 ? "tenant_conflict" : "tenant_create_failed",
              message,
            },
          },
          { status },
        );
      }
    },
  });
}
