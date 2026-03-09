import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { runRegistry } from "@/lib/server/run-registry";
import { subagentRegistry } from "@/lib/server/subagent-registry";

type ParamsContext = {
  params: Promise<unknown>;
};

export async function POST(req: Request, context: ParamsContext) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) {
    return toResponse(access);
  }

  const { id } = (await context.params) as { id?: string };
  if (!id) {
    return Response.json(
      {
        error: {
          code: "bad_request",
          message: "Missing subagent id",
        },
      },
      { status: 400 },
    );
  }

  const decodedId = decodeURIComponent(id);
  const subagent = await subagentRegistry.get(decodedId);
  if (!subagent) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: `Subagent not found: ${decodedId}`,
        },
      },
      { status: 404 },
    );
  }
  if (!canAccessTenant(access.identity, subagent.tenantId)) {
    return tenantBlockedResponse("Subagent", decodedId);
  }

  const reason =
    new URL(req.url).searchParams.get("reason")?.trim() || "cancelled by user";
  const run = await runRegistry.markCancelled(subagent.runId, reason);
  if (!run) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: `Run not found: ${subagent.runId}`,
        },
      },
      { status: 404 },
    );
  }

  return Response.json({
    ok: true,
    subagent_id: subagent.id,
    run_id: subagent.runId,
    run,
  });
}
