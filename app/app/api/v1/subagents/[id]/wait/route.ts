import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import {
  recordRunTerminalSnapshot,
  recordWaitAfterTerminalLatency,
  withObservedRequest,
} from "@/lib/server/observability";
import { runRegistry } from "@/lib/server/run-registry";
import { subagentRegistry } from "@/lib/server/subagent-registry";

type ParamsContext = {
  params: Promise<unknown>;
};

const parseTimeoutMs = (url: URL): number => {
  const raw = url.searchParams.get("timeoutMs");
  if (!raw) {
    return 15000;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 15000;
  }
  return Math.max(1, Math.min(300000, Math.floor(parsed)));
};

export async function GET(req: Request, context: ParamsContext) {
  return withObservedRequest(req, {
    route: "/api/v1/subagents/:id/wait",
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

      const timeoutMs = parseTimeoutMs(new URL(req.url));
      const waited = await runRegistry.waitFor(subagent.runId, timeoutMs);
      if (waited.state === "not_found") {
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
      if (waited.state === "done") {
        recordRunTerminalSnapshot(waited.run.id, waited.run.status);
        if (typeof waited.run.endedAt === "number") {
          recordWaitAfterTerminalLatency(Date.now() - waited.run.endedAt);
        }
      }

      return Response.json({
        ok: true,
        subagent_id: subagent.id,
        run_id: subagent.runId,
        done: waited.state === "done",
        timeoutMs: waited.state === "timeout" ? timeoutMs : undefined,
        run: waited.run,
      });
    },
  });
}
