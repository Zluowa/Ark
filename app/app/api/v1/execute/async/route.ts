import { randomUUID } from "node:crypto";
import { toolJobRegistry } from "@/lib/server/job-registry";
import { runRegistry } from "@/lib/server/run-registry";
import { getToolById } from "@/lib/server/tool-catalog";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import {
  emitJobTerminalWebhook,
  type JobTerminalWebhookInput,
} from "@/lib/server/billing-webhook";
import { resolveCreditsForStatus } from "@/lib/server/billing-policy";
import { reserveExecutionQuota } from "@/lib/server/quota-governor";
import { executeTool, ToolExecutionError } from "@/lib/server/tool-executor";
import { usageLedger, type UsageWriteInput } from "@/lib/server/usage-ledger";
import { withObservedRequest } from "@/lib/server/observability";
import {
  enforceWriteRateLimit,
  parseJsonBodyWithLimit,
  recordAuditEvent,
} from "@/lib/server/security-controls";

type ExecuteAsyncBody = {
  tool?: string;
  params?: Record<string, unknown>;
};

const estimateDurationMs = (toolId: string): number => {
  const tool = getToolById(toolId);
  if (!tool) {
    return 30000;
  }
  const timeoutSec = tool.runtime.timeout;
  if (typeof timeoutSec !== "number" || !Number.isFinite(timeoutSec)) {
    return 30000;
  }
  return Math.max(1000, Math.floor((timeoutSec * 1000) / 2));
};

const appendUsageSafe = async (record: UsageWriteInput): Promise<void> => {
  try {
    await usageLedger.append(record);
  } catch (error) {
    console.error(
      `[billing] usage append failed for run ${record.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const emitWebhookSafe = async (
  payload: JobTerminalWebhookInput,
): Promise<void> => {
  try {
    await emitJobTerminalWebhook(payload);
  } catch (error) {
    console.error(
      `[billing] webhook dispatch failed for job ${payload.jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/execute/async",
    handler: async (observation) => {
      const access = authorizeRequest(req, "execute:write");
      if (!access.ok) {
        return toResponse(access);
      }
      const identity = access.identity;
      observation.setIdentity(identity);

      const rateLimitResponse = enforceWriteRateLimit(
        identity,
        "/api/v1/execute/async",
        observation.requestId,
      );
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const parsedBody = await parseJsonBodyWithLimit<ExecuteAsyncBody>(req, {
        route: "/api/v1/execute/async",
      });
      if (!parsedBody.ok) {
        return parsedBody.response;
      }

      const body = parsedBody.value;
      const tool = typeof body.tool === "string" ? body.tool.trim() : "";
      if (!tool) {
        return Response.json(
          {
            error: {
              code: "bad_request",
              message: "Missing tool id",
            },
          },
          { status: 400 },
        );
      }

      const jobId = randomUUID();
      const etaMs = estimateDurationMs(tool);
      const quota = reserveExecutionQuota(identity);
      if (!quota.ok) {
        return toResponse(quota);
      }

      let job:
        | Awaited<ReturnType<typeof toolJobRegistry.createQueued>>
        | undefined;
      try {
        job = await toolJobRegistry.createQueued(jobId, tool, etaMs, {
          apiKeyId: identity.apiKeyId,
          tenantId: identity.tenantId,
        });
        await runRegistry.createAccepted(jobId, {
          apiKeyId: identity.apiKeyId,
          source: "api.v1.execute.async",
          tenantId: identity.tenantId,
        });
        recordAuditEvent({
          action: "execution.async_enqueued",
          apiKeyId: identity.apiKeyId,
          details: {
            eta_ms: etaMs,
            run_id: jobId,
            tool,
          },
          method: "POST",
          outcome: "allowed",
          requestId: observation.requestId,
          route: "/api/v1/execute/async",
          tenantId: identity.tenantId,
        });
      } catch {
        quota.lease.release();
        return Response.json(
          {
            error: {
              code: "enqueue_error",
              message: "Failed to enqueue async execution.",
            },
          },
          { status: 500 },
        );
      }
      if (!job) {
        quota.lease.release();
        return Response.json(
          {
            error: {
              code: "enqueue_error",
              message: "Failed to enqueue async execution.",
            },
          },
          { status: 500 },
        );
      }

      setTimeout(() => {
        void (async () => {
          const startedAt = Date.now();
          try {
            await toolJobRegistry.markProcessing(jobId, etaMs);
            await runRegistry.markRunning(jobId);

            const execution = await executeTool(tool, body.params ?? {});
            const creditsUsed = resolveCreditsForStatus("succeeded");
            await toolJobRegistry.markCompleted(
              jobId,
              {
                tool: execution.toolId,
                ...execution.result,
              },
              execution.durationMs,
            );
            await runRegistry.markSucceeded(jobId);
            await appendUsageSafe({
              apiKeyId: identity.apiKeyId,
              creditsUsed,
              durationMs: execution.durationMs,
              jobId,
              runId: jobId,
              source: "api.v1.execute.async",
              status: "succeeded",
              tenantId: identity.tenantId,
              tool: execution.toolId,
            });
            await emitWebhookSafe({
              apiKeyId: identity.apiKeyId,
              creditsUsed,
              durationMs: execution.durationMs,
              jobId,
              runId: jobId,
              status: "succeeded",
              tenantId: identity.tenantId,
              tool: execution.toolId,
            });
            recordAuditEvent({
              action: "execution.async_succeeded",
              apiKeyId: identity.apiKeyId,
              details: {
                run_id: jobId,
                tool: execution.toolId,
              },
              method: "POST",
              outcome: "allowed",
              requestId: observation.requestId,
              route: "/api/v1/execute/async",
              tenantId: identity.tenantId,
            });
          } catch (error) {
            const durationMs = Math.max(1, Date.now() - startedAt);
            if (error instanceof ToolExecutionError) {
              const creditsUsed = resolveCreditsForStatus("failed");
              await toolJobRegistry.markFailed(
                jobId,
                error.code,
                error.message,
                durationMs,
              );
              await runRegistry.markFailed(jobId, error.message);
              await appendUsageSafe({
                apiKeyId: identity.apiKeyId,
                creditsUsed,
                durationMs,
                errorCode: error.code,
                errorMessage: error.message,
                jobId,
                runId: jobId,
                source: "api.v1.execute.async",
                status: "failed",
                tenantId: identity.tenantId,
                tool,
              });
              await emitWebhookSafe({
                apiKeyId: identity.apiKeyId,
                creditsUsed,
                durationMs,
                errorCode: error.code,
                errorMessage: error.message,
                jobId,
                runId: jobId,
                status: "failed",
                tenantId: identity.tenantId,
                tool,
              });
              recordAuditEvent({
                action: "execution.async_failed",
                apiKeyId: identity.apiKeyId,
                details: {
                  code: error.code,
                  error: error.message,
                  run_id: jobId,
                  tool,
                },
                method: "POST",
                outcome: "error",
                requestId: observation.requestId,
                route: "/api/v1/execute/async",
                tenantId: identity.tenantId,
              });
              return;
            }

            const message =
              error instanceof Error
                ? error.message
                : "Async tool execution failed.";
            const creditsUsed = resolveCreditsForStatus("failed");
            await toolJobRegistry.markFailed(
              jobId,
              "execution_error",
              message,
              durationMs,
            );
            await runRegistry.markFailed(jobId, message);
            await appendUsageSafe({
              apiKeyId: identity.apiKeyId,
              creditsUsed,
              durationMs,
              errorCode: "execution_error",
              errorMessage: message,
              jobId,
              runId: jobId,
              source: "api.v1.execute.async",
              status: "failed",
              tenantId: identity.tenantId,
              tool,
            });
            await emitWebhookSafe({
              apiKeyId: identity.apiKeyId,
              creditsUsed,
              durationMs,
              errorCode: "execution_error",
              errorMessage: message,
              jobId,
              runId: jobId,
              status: "failed",
              tenantId: identity.tenantId,
              tool,
            });
            recordAuditEvent({
              action: "execution.async_failed",
              apiKeyId: identity.apiKeyId,
              details: {
                code: "execution_error",
                error: message,
                run_id: jobId,
                tool,
              },
              method: "POST",
              outcome: "error",
              requestId: observation.requestId,
              route: "/api/v1/execute/async",
              tenantId: identity.tenantId,
            });
          } finally {
            quota.lease.release();
          }
        })();
      }, 0);

      return Response.json({
        job_id: job.jobId,
        run_id: job.runId,
        status: job.status,
        estimated_duration_ms: job.etaMs,
      });
    },
  });
}
