import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { runRegistry } from "@/lib/server/run-registry";
import { subagentRegistry } from "@/lib/server/subagent-registry";
import { usageLedger } from "@/lib/server/usage-ledger";

type ParamsContext = {
  params: Promise<unknown>;
};

export async function GET(req: Request, context: ParamsContext) {
  const access = authorizeRequest(req, "runs:read");
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

  const run = await runRegistry.get(subagent.runId);
  const usage = (
    await usageLedger.listRecent({
      limit: 1,
      runId: subagent.runId,
      tenantId: subagent.tenantId,
    })
  )[0];

  return Response.json({
    ok: true,
    subagent: {
      id: subagent.id,
      run_id: subagent.runId,
      tool: subagent.tool,
      status: run?.status ?? "accepted",
      tenant_id: subagent.tenantId,
      api_key_id: subagent.apiKeyId,
      spawned_by: subagent.spawnedBy,
      spawn_depth: subagent.spawnDepth,
      effective_scopes: subagent.effectiveScopes,
      created_at: subagent.createdAt,
      usage: usage
        ? {
            status: usage.status,
            source: usage.source,
            credits_used: usage.creditsUsed,
            duration_ms: usage.durationMs,
            error_code: usage.errorCode,
            error_message: usage.errorMessage,
            created_at: usage.createdAt,
          }
        : undefined,
    },
    run,
  });
}
