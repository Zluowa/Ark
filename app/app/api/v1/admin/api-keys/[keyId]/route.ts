import {
  authorizeRequest,
  hasAnyScope,
  hasScope,
} from "@/lib/server/access-control";
import { apiKeyRegistry } from "@/lib/server/api-key-registry";
import { withObservedRequest } from "@/lib/server/observability";
import { toResponse } from "@/lib/shared/result";

type RouteContext = {
  params: Promise<{
    keyId: string;
  }>;
};

export async function DELETE(req: Request, context: RouteContext) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/api-keys/[keyId]",
    handler: async (observation) => {
      const access = authorizeRequest(req, []);
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      if (!hasAnyScope(access.identity, ["admin:*", "keys:write"])) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "auth_forbidden_scope",
              message: "Missing required scope: keys:write",
            },
          },
          { status: 403 },
        );
      }

      const params = await context.params;
      const keyId = decodeURIComponent(params.keyId ?? "").trim();
      if (!keyId) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "invalid_api_key_id",
              message: "API key id is required.",
            },
          },
          { status: 400 },
        );
      }

      const existing = apiKeyRegistry.getSummary(keyId);
      if (!existing) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "api_key_not_found",
              message: `API key not found: ${keyId}`,
            },
          },
          { status: 404 },
        );
      }
      if (
        !hasScope(access.identity, "admin:*") &&
        existing.tenantId !== access.identity.tenantId
      ) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "auth_forbidden_scope",
              message: "Tenant bootstrap keys can only revoke keys in their own tenant.",
            },
          },
          { status: 403 },
        );
      }

      try {
        const revoked = apiKeyRegistry.revoke(keyId);
        if (!revoked) {
          return Response.json({ ok: false, error: { code: "api_key_not_found", message: `API key not found: ${keyId}` } }, { status: 404 });
        }
        return Response.json({
          ok: true,
          key: revoked,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to revoke API key.";
        return Response.json(
          {
            ok: false,
            error: {
              code: "api_key_revoke_failed",
              message,
            },
          },
          { status: 409 },
        );
      }
    },
  });
}
