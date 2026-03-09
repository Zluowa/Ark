import { randomUUID } from "node:crypto";
import { runRegistry } from "@/lib/server/run-registry";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { resolveCreditsForStatus } from "@/lib/server/billing-policy";
import { reserveExecutionQuota } from "@/lib/server/quota-governor";
import { executeTool, ToolExecutionError } from "@/lib/server/tool-executor";
import { usageLedger } from "@/lib/server/usage-ledger";
import { withObservedRequest } from "@/lib/server/observability";
import {
  enforceWriteRateLimit,
  parseJsonBodyWithLimit,
  recordAuditEvent,
} from "@/lib/server/security-controls";

type ExecuteRequestBody = {
  tool?: string;
  params?: Record<string, unknown>;
};

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/execute",
    handler: async (observation) => {
      const access = authorizeRequest(req, "execute:write");
      if (!access.ok) {
        return toResponse(access);
      }
      const identity = access.identity;
      observation.setIdentity(identity);

      const rateLimitResponse = enforceWriteRateLimit(
        identity,
        "/api/v1/execute",
        observation.requestId,
      );
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const parsedBody = await parseJsonBodyWithLimit<ExecuteRequestBody>(req, {
        route: "/api/v1/execute",
      });
      if (!parsedBody.ok) {
        return parsedBody.response;
      }
      const body = parsedBody.value;
      const runId = randomUUID();
      const tool = typeof body.tool === "string" ? body.tool : "";

      const quota = reserveExecutionQuota(identity);
      if (!quota.ok) {
        return toResponse(quota);
      }

      try {
        await runRegistry.createAccepted(runId, {
          apiKeyId: identity.apiKeyId,
          source: "api.v1.execute",
          tenantId: identity.tenantId,
        });
        await runRegistry.markRunning(runId);
        recordAuditEvent({
          action: "execution.tool_started",
          apiKeyId: identity.apiKeyId,
          details: { run_id: runId, tool },
          method: "POST",
          outcome: "allowed",
          requestId: observation.requestId,
          route: "/api/v1/execute",
          tenantId: identity.tenantId,
        });
        const startedAt = Date.now();

        try {
          const execution = await executeTool(tool, body.params ?? {}, { tenantId: identity.tenantId });
          await runRegistry.markSucceeded(runId);
          const creditsUsed = resolveCreditsForStatus("succeeded");
          try {
            await usageLedger.append({
              apiKeyId: identity.apiKeyId,
              creditsUsed,
              durationMs: execution.durationMs,
              runId,
              source: "api.v1.execute",
              status: "succeeded",
              tenantId: identity.tenantId,
              tool: execution.toolId,
            });
          } catch (meterError) {
            console.error(
              `[billing] usage append failed for run ${runId}: ${
                meterError instanceof Error
                  ? meterError.message
                  : String(meterError)
              }`,
            );
          }

          recordAuditEvent({
            action: "execution.tool_succeeded",
            apiKeyId: identity.apiKeyId,
            details: { run_id: runId, tool: execution.toolId },
            method: "POST",
            outcome: "allowed",
            requestId: observation.requestId,
            route: "/api/v1/execute",
            tenantId: identity.tenantId,
          });
          return Response.json({
            status: "success",
            tool: execution.toolId,
            run_id: runId,
            result: execution.result,
            duration_ms: execution.durationMs,
            credits_used: creditsUsed,
          });
        } catch (error) {
          const durationMs = Math.max(1, Date.now() - startedAt);
          if (error instanceof ToolExecutionError) {
            await runRegistry.markFailed(runId, error.message);
            try {
              await usageLedger.append({
                apiKeyId: identity.apiKeyId,
                creditsUsed: resolveCreditsForStatus("failed"),
                durationMs,
                errorCode: error.code,
                errorMessage: error.message,
                runId,
                source: "api.v1.execute",
                status: "failed",
                tenantId: identity.tenantId,
                tool: tool || "unknown",
              });
            } catch (meterError) {
              console.error(
                `[billing] usage append failed for run ${runId}: ${
                  meterError instanceof Error
                    ? meterError.message
                    : String(meterError)
                }`,
              );
            }
            recordAuditEvent({
              action: "execution.tool_failed",
              apiKeyId: identity.apiKeyId,
              details: {
                code: error.code,
                error: error.message,
                run_id: runId,
                tool: tool || "unknown",
              },
              method: "POST",
              outcome: "error",
              requestId: observation.requestId,
              route: "/api/v1/execute",
              tenantId: identity.tenantId,
            });
            return Response.json(
              {
                status: "failed",
                run_id: runId,
                error: {
                  code: error.code,
                  message: error.message,
                },
              },
              { status: error.status },
            );
          }

          const message =
            error instanceof Error ? error.message : "Tool execution failed.";
          await runRegistry.markFailed(runId, message);
          try {
            await usageLedger.append({
              apiKeyId: identity.apiKeyId,
              creditsUsed: resolveCreditsForStatus("failed"),
              durationMs,
              errorCode: "execution_error",
              errorMessage: message,
              runId,
              source: "api.v1.execute",
              status: "failed",
              tenantId: identity.tenantId,
              tool: tool || "unknown",
            });
          } catch (meterError) {
            console.error(
              `[billing] usage append failed for run ${runId}: ${
                meterError instanceof Error
                  ? meterError.message
                  : String(meterError)
              }`,
            );
          }
          recordAuditEvent({
            action: "execution.tool_failed",
            apiKeyId: identity.apiKeyId,
            details: {
              code: "execution_error",
              error: message,
              run_id: runId,
              tool: tool || "unknown",
            },
            method: "POST",
            outcome: "error",
            requestId: observation.requestId,
            route: "/api/v1/execute",
            tenantId: identity.tenantId,
          });
          return Response.json(
            {
              status: "failed",
              run_id: runId,
              error: {
                code: "execution_error",
                message,
              },
            },
            { status: 500 },
          );
        }
      } finally {
        quota.lease.release();
      }
    },
  });
}
