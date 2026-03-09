import { randomUUID } from "node:crypto";
import { analyzeFastChannel } from "@/lib/server/fast-channel-router";
import { toolJobRegistry } from "@/lib/server/job-registry";
import { runRegistry } from "@/lib/server/run-registry";
import { getToolById } from "@/lib/server/tool-catalog";
import { authorizeRequest, type AuthIdentity } from "@/lib/server/access-control";
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

type DispatchRequestBody = {
  prompt?: string;
  tool?: string;
  params?: unknown;
  mode?: "sync" | "async";
  threshold?: number;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
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

type DispatchContext = {
  identity: AuthIdentity;
  decision: ReturnType<typeof analyzeFastChannel>;
  params: Record<string, unknown>;
  requestId: string | undefined;
};

const runAsyncJob = async (
  ctx: DispatchContext,
  jobId: string,
  etaMs: number,
): Promise<void> => {
  const { identity, decision, params } = ctx;
  const startedAt = Date.now();
  const toolId = decision.toolId ?? "unknown";
  try {
    await toolJobRegistry.markProcessing(jobId, etaMs);
    await runRegistry.markRunning(jobId);
    const execution = await executeTool(toolId, params);
    const creditsUsed = resolveCreditsForStatus("succeeded");
    await toolJobRegistry.markCompleted(jobId, { tool: execution.toolId, ...execution.result }, execution.durationMs);
    await runRegistry.markSucceeded(jobId);
    await appendUsageSafe({ apiKeyId: identity.apiKeyId, creditsUsed, durationMs: execution.durationMs, jobId, runId: jobId, source: "api.v1.dispatch.async", status: "succeeded", tenantId: identity.tenantId, tool: execution.toolId });
    await emitWebhookSafe({ apiKeyId: identity.apiKeyId, creditsUsed, durationMs: execution.durationMs, jobId, runId: jobId, status: "succeeded", tenantId: identity.tenantId, tool: execution.toolId });
  } catch (error) {
    const durationMs = Math.max(1, Date.now() - startedAt);
    const isToolError = error instanceof ToolExecutionError;
    const errorCode = isToolError ? error.code : "execution_error";
    const errorMessage = isToolError ? error.message : (error instanceof Error ? error.message : "Async dispatch failed");
    const creditsUsed = resolveCreditsForStatus("failed");
    await toolJobRegistry.markFailed(jobId, errorCode, errorMessage, durationMs);
    await runRegistry.markFailed(jobId, errorMessage);
    await appendUsageSafe({ apiKeyId: identity.apiKeyId, creditsUsed, durationMs, errorCode, errorMessage, jobId, runId: jobId, source: "api.v1.dispatch.async", status: "failed", tenantId: identity.tenantId, tool: toolId });
    await emitWebhookSafe({ apiKeyId: identity.apiKeyId, creditsUsed, durationMs, errorCode, errorMessage, jobId, runId: jobId, status: "failed", tenantId: identity.tenantId, tool: toolId });
  }
};

const handleAsyncDispatch = async (ctx: DispatchContext): Promise<Response> => {
  const { identity, decision } = ctx;
  const quota = reserveExecutionQuota(identity);
  if (!quota.ok) return toResponse(quota);

  const jobId = randomUUID();
  const etaMs = estimateDurationMs(decision.toolId!);
  let job: Awaited<ReturnType<typeof toolJobRegistry.createQueued>> | undefined;
  try {
    job = await toolJobRegistry.createQueued(jobId, decision.toolId!, etaMs, { apiKeyId: identity.apiKeyId, tenantId: identity.tenantId });
    await runRegistry.createAccepted(jobId, { apiKeyId: identity.apiKeyId, source: "api.v1.dispatch.async", tenantId: identity.tenantId });
  } catch {
    quota.lease.release();
    return Response.json({ ok: false, error: { code: "enqueue_error", message: "Failed to enqueue async dispatch." } }, { status: 500 });
  }
  if (!job) {
    quota.lease.release();
    return Response.json({ ok: false, error: { code: "enqueue_error", message: "Failed to enqueue async dispatch." } }, { status: 500 });
  }

  setTimeout(() => {
    void runAsyncJob(ctx, jobId, etaMs).finally(() => quota.lease.release());
  }, 0);

  return Response.json({
    ok: true,
    channel: "fast",
    mode: "async",
    match: { matched: true, tool: decision.toolId, confidence: decision.confidence, reasons: decision.reasons },
    execution: { job_id: job.jobId, run_id: job.runId, status: job.status, estimated_duration_ms: job.etaMs },
    suggestions: decision.suggestions,
  });
};

const handleSyncDispatch = async (ctx: DispatchContext): Promise<Response> => {
  const { identity, decision, params } = ctx;
  const quota = reserveExecutionQuota(identity);
  if (!quota.ok) return toResponse(quota);

  const runId = randomUUID();
  try {
    await runRegistry.createAccepted(runId, { apiKeyId: identity.apiKeyId, source: "api.v1.dispatch.sync", tenantId: identity.tenantId });
    await runRegistry.markRunning(runId);
    const startedAt = Date.now();
    try {
      const execution = await executeTool(decision.toolId!, params);
      await runRegistry.markSucceeded(runId);
      const creditsUsed = resolveCreditsForStatus("succeeded");
      await appendUsageSafe({ apiKeyId: identity.apiKeyId, creditsUsed, durationMs: execution.durationMs, runId, source: "api.v1.dispatch.sync", status: "succeeded", tenantId: identity.tenantId, tool: execution.toolId });
      return Response.json({
        ok: true,
        channel: "fast",
        mode: "sync",
        match: { matched: true, tool: decision.toolId, confidence: decision.confidence, reasons: decision.reasons },
        execution: { status: "success", run_id: runId, result: execution.result, duration_ms: execution.durationMs, credits_used: creditsUsed },
        suggestions: decision.suggestions,
      });
    } catch (error) {
      const durationMs = Math.max(1, Date.now() - startedAt);
      if (error instanceof ToolExecutionError) {
        await runRegistry.markFailed(runId, error.message);
        await appendUsageSafe({ apiKeyId: identity.apiKeyId, creditsUsed: resolveCreditsForStatus("failed"), durationMs, errorCode: error.code, errorMessage: error.message, runId, source: "api.v1.dispatch.sync", status: "failed", tenantId: identity.tenantId, tool: decision.toolId! });
        return Response.json(
          { ok: true, channel: "fast", mode: "sync", match: { matched: true, tool: decision.toolId, confidence: decision.confidence, reasons: decision.reasons }, execution: { status: "failed", run_id: runId, error: { code: error.code, message: error.message } }, suggestions: decision.suggestions },
          { status: error.status },
        );
      }
      const message = error instanceof Error ? error.message : "Dispatch execution failed";
      await runRegistry.markFailed(runId, message);
      await appendUsageSafe({ apiKeyId: identity.apiKeyId, creditsUsed: resolveCreditsForStatus("failed"), durationMs, errorCode: "execution_error", errorMessage: message, runId, source: "api.v1.dispatch.sync", status: "failed", tenantId: identity.tenantId, tool: decision.toolId! });
      return Response.json({ ok: false, error: { code: "execution_error", message } }, { status: 500 });
    }
  } finally {
    quota.lease.release();
  }
};

export async function POST(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/dispatch",
    handler: async (observation) => {
      const access = authorizeRequest(req, "execute:write");
      if (!access.ok) return toResponse(access);
      const identity = access.identity;
      observation.setIdentity(identity);

      const rateLimitResponse = enforceWriteRateLimit(identity, "/api/v1/dispatch", observation.requestId);
      if (rateLimitResponse) return rateLimitResponse;

      const parsedBody = await parseJsonBodyWithLimit<DispatchRequestBody>(req, { route: "/api/v1/dispatch" });
      if (!parsedBody.ok) return parsedBody.response;

      const body = parsedBody.value;
      const mode = body.mode === "async" ? "async" : "sync";
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const explicitTool = typeof body.tool === "string" ? body.tool : undefined;

      if (!prompt.trim() && !explicitTool?.trim()) {
        return Response.json({ ok: false, error: { code: "bad_request", message: "Missing prompt or tool" } }, { status: 400 });
      }

      const decision = analyzeFastChannel({ prompt, explicitToolId: explicitTool, threshold: body.threshold });
      recordAuditEvent({ action: "execution.dispatch_decision", apiKeyId: identity.apiKeyId, details: { confidence: decision.confidence, matched: decision.matched, mode, tool: decision.toolId }, method: "POST", outcome: "allowed", requestId: observation.requestId, route: "/api/v1/dispatch", tenantId: identity.tenantId });

      if (!decision.matched || !decision.toolId) {
        return Response.json({ ok: true, channel: "fallback", match: { matched: false, confidence: decision.confidence, threshold: decision.threshold, reasons: decision.reasons }, suggestions: decision.suggestions, hint: "Specify tool id or refine prompt for a stronger match." });
      }

      const ctx: DispatchContext = { identity, decision, params: asObject(body.params), requestId: observation.requestId };
      return mode === "async" ? handleAsyncDispatch(ctx) : handleSyncDispatch(ctx);
    },
  });
}
