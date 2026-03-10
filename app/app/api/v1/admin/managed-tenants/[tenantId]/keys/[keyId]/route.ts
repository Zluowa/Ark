import { authorizeRequest } from "@/lib/server/access-control";
import { apiKeyRegistry } from "@/lib/server/api-key-registry";
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ tenantId: string; keyId: string }> },
) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/managed-tenants/[tenantId]/keys/[keyId]",
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

      const { tenantId, keyId } = await params;
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

      const summary = apiKeyRegistry.getSummary(keyId);
      if (!summary || summary.tenantId !== tenantId) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "managed_tenant_key_not_found",
              message: `Managed tenant key not found: ${keyId}`,
            },
          },
          { status: 404 },
        );
      }

      if (!summary.revocable) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "managed_tenant_key_not_revocable",
              message: "Environment-managed keys cannot be revoked through the managed control plane.",
            },
          },
          { status: 409 },
        );
      }

      const revoked = apiKeyRegistry.revoke(keyId);
      if (!revoked) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "managed_tenant_key_not_found",
              message: `Managed tenant key not found: ${keyId}`,
            },
          },
          { status: 404 },
        );
      }

      return Response.json({
        ok: true,
        service_mode: env.serviceMode,
        tenant_key: revoked,
      });
    },
  });
}
