import { authorizeRequest } from "@/lib/server/access-control";
import { apiKeyRegistry, type CreateApiKeyInput } from "@/lib/server/api-key-registry";
import { getServerEnv } from "@/lib/server/env";
import { withObservedRequest } from "@/lib/server/observability";
import { tenantRegistry } from "@/lib/server/tenant-registry";
import { toResponse } from "@/lib/shared/result";

const serviceModeDisabledResponse = () =>
  Response.json(
    {
      ok: false,
      error: {
        code: "service_mode_disabled",
        message:
          "Managed tenant key control requires OMNIAGENT_SERVICE_MODE=managed_ark_key.",
      },
    },
    { status: 409 },
  );

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
  tenantId: string,
): Promise<
  | {
      ok: true;
      value: CreateApiKeyInput & { revokeExisting: boolean };
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
      ...(typeof input.id === "string" && input.id.trim()
        ? { id: input.id.trim() }
        : {}),
      ...(typeof input.key === "string" && input.key.trim()
        ? { key: input.key.trim() }
        : {}),
      quota: parseQuota(input.quota),
      scopes,
      tenantId,
      revokeExisting:
        input.revoke_existing === true ||
        input.rotate === true ||
        input.rotation === true,
    },
  };
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/managed-tenants/[tenantId]/keys",
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

      const parsed = await parseCreateBody(req, tenantId);
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
        if (parsed.value.revokeExisting) {
          const tenantKeys = apiKeyRegistry.list({ tenantId });
          for (const key of tenantKeys) {
            if (key.revocable && key.status === "active") {
              apiKeyRegistry.revoke(key.id);
            }
          }
        }
        const created = apiKeyRegistry.create({
          ...parsed.value,
          createdBy: access.identity.apiKeyId,
        });
        return Response.json(
          {
            ok: true,
            service_mode: env.serviceMode,
            tenant_api_key: created.apiKey,
            tenant_key: created.summary,
          },
          { status: 201 },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to create managed tenant key.";
        const status = /already exists/i.test(message) ? 409 : 400;
        return Response.json(
          {
            ok: false,
            error: {
              code:
                status === 409
                  ? "managed_tenant_key_conflict"
                  : "managed_tenant_key_create_failed",
              message,
            },
          },
          { status },
        );
      }
    },
  });
}
