import { randomUUID } from "node:crypto";
import { runRegistry } from "@/lib/server/run-registry";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { resolveCreditsForStatus } from "@/lib/server/billing-policy";
import { reserveExecutionQuota } from "@/lib/server/quota-governor";
import { executeTool, ToolExecutionError } from "@/lib/server/tool-executor";
import { usageLedger } from "@/lib/server/usage-ledger";
import {
  enforceWriteRateLimit,
  parseJsonBodyWithLimit,
  recordAuditEvent,
} from "@/lib/server/security-controls";

type ParamsContext = {
  params: Promise<unknown>;
};

type ToolTestRequestBody = {
  params?: Record<string, unknown>;
};

export async function POST(req: Request, context: ParamsContext) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) {
    return toResponse(access);
  }
  const identity = access.identity;
  const rateLimitResponse = enforceWriteRateLimit(
    identity,
    "/api/v1/tools/:toolId/test",
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { toolId } = (await context.params) as { toolId?: string };
  if (!toolId) {
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

  const parsedBody = await parseJsonBodyWithLimit<ToolTestRequestBody>(req, {
    route: "/api/v1/tools/:toolId/test",
  });
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.value;
  const decodedToolId = decodeURIComponent(toolId);
  const runId = randomUUID();
  const quota = reserveExecutionQuota(identity);
  if (!quota.ok) {
    return toResponse(quota);
  }

  try {
    await runRegistry.createAccepted(runId, {
      apiKeyId: identity.apiKeyId,
      source: "api.v1.tools.test",
      tenantId: identity.tenantId,
    });
    await runRegistry.markRunning(runId);
    recordAuditEvent({
      action: "execution.tool_test_started",
      apiKeyId: identity.apiKeyId,
      details: {
        run_id: runId,
        tool: decodedToolId,
      },
      method: "POST",
      outcome: "allowed",
      route: "/api/v1/tools/:toolId/test",
      tenantId: identity.tenantId,
    });
    const startedAt = Date.now();

    try {
      const execution = await executeTool(decodedToolId, body.params ?? {});
      await runRegistry.markSucceeded(runId);
      const creditsUsed = resolveCreditsForStatus("succeeded");
      try {
        await usageLedger.append({
          apiKeyId: identity.apiKeyId,
          creditsUsed,
          durationMs: execution.durationMs,
          runId,
          source: "api.v1.tools.test",
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

      return Response.json({
        ok: true,
        status: "success",
        run_id: runId,
        tool: execution.toolId,
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
            source: "api.v1.tools.test",
            status: "failed",
            tenantId: identity.tenantId,
            tool: decodedToolId,
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
        return Response.json(
          {
            ok: false,
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
        error instanceof Error ? error.message : "Tool test execution failed.";
      await runRegistry.markFailed(runId, message);
      try {
        await usageLedger.append({
          apiKeyId: identity.apiKeyId,
          creditsUsed: resolveCreditsForStatus("failed"),
          durationMs,
          errorCode: "execution_error",
          errorMessage: message,
          runId,
          source: "api.v1.tools.test",
          status: "failed",
          tenantId: identity.tenantId,
          tool: decodedToolId,
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
      return Response.json(
        {
          ok: false,
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
}
