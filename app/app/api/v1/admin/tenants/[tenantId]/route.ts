import { authorizeRequest } from "@/lib/server/access-control";
import { tenantRegistry, type TenantStatus } from "@/lib/server/tenant-registry";
import { withObservedRequest } from "@/lib/server/observability";
import { toResponse } from "@/lib/shared/result";

type RouteContext = {
  params: Promise<{
    tenantId: string;
  }>;
};

const parseQuota = (value: unknown) => {
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

const parseStatus = (value: unknown): TenantStatus | undefined => {
  if (value === "active" || value === "suspended") {
    return value;
  }
  return undefined;
};

export async function GET(req: Request, context: RouteContext) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/tenants/[tenantId]",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const params = await context.params;
      const tenantId = decodeURIComponent(params.tenantId ?? "").trim();
      const tenant = tenantRegistry.get(tenantId);
      if (!tenant) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "tenant_not_found",
              message: `Tenant not found: ${tenantId}`,
            },
          },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, tenant });
    },
  });
}

export async function PATCH(req: Request, context: RouteContext) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/tenants/[tenantId]",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const params = await context.params;
      const tenantId = decodeURIComponent(params.tenantId ?? "").trim();
      if (!tenantId) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "invalid_tenant_id",
              message: "Tenant id is required.",
            },
          },
          { status: 400 },
        );
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json(
          {
            ok: false,
            error: {
              code: "invalid_json",
              message: "Request body must be valid JSON.",
            },
          },
          { status: 400 },
        );
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "invalid_body",
              message: "Request body must be a JSON object.",
            },
          },
          { status: 400 },
        );
      }
      const input = body as Record<string, unknown>;
      if (input.status !== undefined && !parseStatus(input.status)) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "invalid_tenant_status",
              message: "Tenant status must be `active` or `suspended`.",
            },
          },
          { status: 400 },
        );
      }
      const updated = tenantRegistry.update(tenantId, {
        ...(typeof input.name === "string" ? { name: input.name } : {}),
        ...(input.quota !== undefined ? { quota: parseQuota(input.quota) } : {}),
        ...(input.status !== undefined
          ? { status: parseStatus(input.status) }
          : {}),
      });
      if (!updated) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "tenant_not_found",
              message: `Tenant not found: ${tenantId}`,
            },
          },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, tenant: updated });
    },
  });
}
