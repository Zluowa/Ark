import { runRegistry } from "@/lib/server/run-registry";
import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { withObservedRequest } from "@/lib/server/observability";
import { recordAuditEvent } from "@/lib/server/security-controls";

type ParamsContext = {
  params: Promise<unknown>;
};

export async function POST(req: Request, context: ParamsContext) {
  return withObservedRequest(req, {
    route: "/api/runs/:id/cancel",
    handler: async (observation) => {
      const access = authorizeRequest(req, "execute:write");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const { id } = (await context.params) as { id?: string };
      if (!id) {
        return Response.json(
          {
            error: {
              code: "bad_request",
              message: "Missing run id",
            },
          },
          { status: 400 },
        );
      }
      const current = await runRegistry.get(id);
      if (!current) {
        return Response.json(
          {
            error: {
              code: "not_found",
              message: `Run not found: ${id}`,
            },
          },
          { status: 404 },
        );
      }
      if (!canAccessTenant(access.identity, current.tenantId)) {
        return tenantBlockedResponse("Run", id);
      }

      const reason =
        new URL(req.url).searchParams.get("reason")?.trim() ||
        "cancelled by user";
      const run = await runRegistry.markCancelled(id, reason);
      if (!run) {
        return Response.json(
          {
            error: {
              code: "not_found",
              message: `Run not found: ${id}`,
            },
          },
          { status: 404 },
        );
      }

      recordAuditEvent({
        action: "execution.run_cancelled",
        apiKeyId: access.identity.apiKeyId,
        details: {
          reason,
          run_id: id,
        },
        method: "POST",
        outcome: "allowed",
        requestId: observation.requestId,
        route: "/api/runs/:id/cancel",
        tenantId: access.identity.tenantId,
      });

      return Response.json({ ok: true, run });
    },
  });
}
