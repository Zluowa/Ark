import { runRegistry } from "@/lib/server/run-registry";
import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { withObservedRequest } from "@/lib/server/observability";

type ParamsContext = {
  params: Promise<unknown>;
};

export async function GET(req: Request, context: ParamsContext) {
  return withObservedRequest(req, {
    route: "/api/runs/:id",
    handler: async (observation) => {
      const access = authorizeRequest(req, "runs:read");
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
      const run = await runRegistry.get(id);
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
      if (!canAccessTenant(access.identity, run.tenantId)) {
        return tenantBlockedResponse("Run", id);
      }

      return Response.json({ ok: true, run });
    },
  });
}
