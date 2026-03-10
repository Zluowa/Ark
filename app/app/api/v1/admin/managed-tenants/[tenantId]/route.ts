import { authorizeRequest } from "@/lib/server/access-control";
import { getServerEnv, type ApiKeyQuotaConfig } from "@/lib/server/env";
import { withObservedRequest } from "@/lib/server/observability";
import { tenantRegistry } from "@/lib/server/tenant-registry";
import { usageLedger } from "@/lib/server/usage-ledger";
import { apiKeyRegistry } from "@/lib/server/api-key-registry";
import { toResponse } from "@/lib/shared/result";

const serviceModeDisabledResponse = () =>
  Response.json(
    {
      ok: false,
      error: {
        code: "service_mode_disabled",
        message:
          "Managed tenant control requires OMNIAGENT_SERVICE_MODE=managed_ark_key.",
      },
    },
    { status: 409 },
  );

const parseLimit = (req: Request): number => {
  const raw = new URL(req.url).searchParams.get("limit");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(1, Math.min(500, Math.floor(parsed)));
};

const parseQuota = (value: unknown): ApiKeyQuotaConfig | undefined => {
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

const parsePatchBody = async (
  req: Request,
): Promise<
  | {
      ok: true;
      value: {
        name?: string;
        quota?: ApiKeyQuotaConfig;
        status?: "active" | "suspended";
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
  const status =
    input.status === "active" || input.status === "suspended"
      ? input.status
      : undefined;
  if (input.status !== undefined && !status) {
    return {
      ok: false,
      error: {
        code: "invalid_tenant_status",
        message: "Status must be `active` or `suspended`.",
        status: 400,
      },
    };
  }
  return {
    ok: true,
    value: {
      ...(typeof input.name === "string" ? { name: input.name } : {}),
      ...(input.quota !== undefined ? { quota: parseQuota(input.quota) } : {}),
      ...(status ? { status } : {}),
    },
  };
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/managed-tenants/[tenantId]",
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

      const tenantId = (await params).tenantId.trim();
      const tenant = tenantRegistry.get(tenantId);
      if (!tenant) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "managed_tenant_not_found",
              message: `Managed tenant not found: ${tenantId}`,
            },
          },
          { status: 404 },
        );
      }

      const tenantKeys = apiKeyRegistry.list({ tenantId });
      const usageSummary = await usageLedger.summarize(tenantId);
      const usage = await usageLedger.listRecent({
        tenantId,
        limit: parseLimit(req),
      });

      return Response.json({
        ok: true,
        service_mode: env.serviceMode,
        tenant,
        tenant_keys: tenantKeys,
        active_key_count: tenantKeys.filter((key) => key.status === "active")
          .length,
        total_key_count: tenantKeys.length,
        usage_summary: usageSummary,
        usage,
      });
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/managed-tenants/[tenantId]",
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

      const tenantId = (await params).tenantId.trim();
      if (!tenantRegistry.get(tenantId)) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "managed_tenant_not_found",
              message: `Managed tenant not found: ${tenantId}`,
            },
          },
          { status: 404 },
        );
      }

      const parsed = await parsePatchBody(req);
      if (!parsed.ok) {
        return Response.json(
          {
            ok: false,
            error: parsed.error,
          },
          { status: parsed.error.status },
        );
      }

      const tenant = tenantRegistry.update(tenantId, parsed.value);
      if (!tenant) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "managed_tenant_not_found",
              message: `Managed tenant not found: ${tenantId}`,
            },
          },
          { status: 404 },
        );
      }

      return Response.json({
        ok: true,
        service_mode: env.serviceMode,
        tenant,
      });
    },
  });
}
