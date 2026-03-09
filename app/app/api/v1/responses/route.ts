import { randomUUID } from "node:crypto";
import { analyzeFastChannel } from "@/lib/server/fast-channel-router";
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
import {
  enforceWriteRateLimit,
  parseJsonBodyWithLimit,
  recordAuditEvent,
} from "@/lib/server/security-controls";

type ResponsesRequestBody = {
  input?: unknown;
  metadata?: Record<string, unknown>;
  mode?: "sync" | "async";
  model?: string;
  params?: Record<string, unknown>;
  source?: string;
  threshold?: number;
  tool?: string;
};

type ResponseStatus =
  | "completed"
  | "failed"
  | "in_progress"
  | "cancelled"
  | "queued";

const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const extractPrompt = (input: unknown): string => {
  if (typeof input === "string") {
    return input;
  }
  if (!Array.isArray(input)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.content === "string") {
      parts.push(record.content);
      continue;
    }
    if (Array.isArray(record.content)) {
      for (const contentPart of record.content) {
        if (
          contentPart &&
          typeof contentPart === "object" &&
          (contentPart as Record<string, unknown>).type === "input_text" &&
          typeof (contentPart as Record<string, unknown>).text === "string"
        ) {
          parts.push((contentPart as Record<string, unknown>).text as string);
        }
      }
    }
  }
  return parts.join("\n").trim();
};

const parseParams = (body: ResponsesRequestBody): Record<string, unknown> => {
  if (body.params && typeof body.params === "object") {
    return body.params;
  }
  const metadata = asObject(body.metadata);
  const fromMetadata = metadata.params;
  if (
    fromMetadata &&
    typeof fromMetadata === "object" &&
    !Array.isArray(fromMetadata)
  ) {
    return fromMetadata as Record<string, unknown>;
  }
  return {};
};

const resolveSource = (req: Request, body: ResponsesRequestBody): string => {
  const fromBody = body.source?.trim();
  if (fromBody) return fromBody;
  const fromHeader =
    req.headers.get("x-omni-source")?.trim() ||
    req.headers.get("x-source")?.trim();
  if (fromHeader) return fromHeader;
  return "api.v1.responses";
};

const summarizeResultText = (result: Record<string, unknown>): string => {
  const outputFile =
    typeof result.output_file_url === "string" ? result.output_file_url : "";
  if (outputFile) {
    return `Completed. Output file: ${outputFile}`;
  }
  const maybeText = typeof result.text === "string" ? result.text : "";
  if (maybeText) {
    return maybeText;
  }
  const json = JSON.stringify(result);
  return json.length > 1000 ? `${json.slice(0, 1000)}...` : json;
};

const mapRunStatusToResponsesStatus = (status: string): ResponseStatus => {
  if (status === "accepted") return "queued";
  if (status === "running") return "in_progress";
  if (status === "succeeded") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
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

const toResponseEnvelope = (input: {
  createdAtMs: number;
  error?: { code: string; message: string };
  model?: string;
  outputText?: string;
  responseId: string;
  result?: Record<string, unknown>;
  runId: string;
  status: ResponseStatus;
  tool?: string;
  usage?: { credits_used: number };
}) => {
  const output =
    typeof input.outputText === "string" && input.outputText.trim()
      ? [
          {
            content: [
              {
                text: input.outputText,
                type: "output_text",
              },
            ],
            id: `msg_${input.responseId}`,
            role: "assistant",
            type: "message",
          },
        ]
      : [];

  return {
    created_at: Math.floor(input.createdAtMs / 1000),
    error: input.error ?? null,
    id: input.responseId,
    model: input.model ?? "omniagent-fast-channel",
    object: "response",
    output,
    result: input.result,
    run_id: input.runId,
    status: input.status,
    tool: input.tool,
    usage: input.usage ?? undefined,
  };
};

const shouldBeAsync = (mode: string | undefined): boolean => mode === "async";

export async function POST(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) {
    return toResponse(access);
  }
  const identity = access.identity;
  const rateLimitResponse = enforceWriteRateLimit(
    identity,
    "/api/v1/responses",
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  const parsedBody = await parseJsonBodyWithLimit<ResponsesRequestBody>(req, {
    route: "/api/v1/responses",
  });
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.value;
  const source = resolveSource(req, body);
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  const idempotencySource = `${identity.tenantId}:${source}`;
  let runId: string = randomUUID();
  let idempotencyReused = false;

  if (idempotencyKey) {
    const existingRunId = await runRegistry.getRunIdByIdempotency(
      idempotencyKey,
      idempotencySource,
    );
    if (existingRunId) {
      runId = existingRunId;
      idempotencyReused = true;
    } else {
      await runRegistry.setIdempotency(
        idempotencyKey,
        idempotencySource,
        runId,
      );
    }
  }

  if (idempotencyReused) {
    const run = await runRegistry.get(runId);
    recordAuditEvent({
      action: "execution.responses_reused",
      apiKeyId: identity.apiKeyId,
      details: { run_id: runId, source },
      method: "POST",
      outcome: "allowed",
      route: "/api/v1/responses",
      tenantId: identity.tenantId,
    });
    return Response.json(
      {
        ...toResponseEnvelope({
          createdAtMs: run?.acceptedAt ?? Date.now(),
          model: body.model,
          responseId: `resp_${runId}`,
          runId,
          status: mapRunStatusToResponsesStatus(run?.status ?? "failed"),
        }),
        reused: true,
        run,
      },
      {
        headers: {
          "x-idempotency-reused": "1",
          "x-run-id": runId,
        },
      },
    );
  }

  const prompt = extractPrompt(body.input);
  const explicitTool = typeof body.tool === "string" ? body.tool.trim() : "";
  const decision = analyzeFastChannel({
    explicitToolId: explicitTool || undefined,
    prompt,
    threshold: body.threshold,
  });
  const toolId = explicitTool || decision.toolId || "";
  if (!toolId) {
    return Response.json(
      {
        error: {
          code: "bad_request",
          message:
            "Missing executable tool. Provide `tool` or a dispatchable prompt in `input`.",
        },
      },
      { status: 400 },
    );
  }

  const params = parseParams(body);
  const mode = shouldBeAsync(body.mode) ? "async" : "sync";
  if (mode === "async") {
    const quota = reserveExecutionQuota(identity);
    if (!quota.ok) {
      return toResponse(quota);
    }

    const jobId = runId;
    const etaMs = estimateDurationMs(toolId);
    let job:
      | Awaited<ReturnType<typeof toolJobRegistry.createQueued>>
      | undefined;
    try {
      job = await toolJobRegistry.createQueued(jobId, toolId, etaMs, {
        apiKeyId: identity.apiKeyId,
        tenantId: identity.tenantId,
      });
      await runRegistry.createAccepted(jobId, {
        apiKeyId: identity.apiKeyId,
        source,
        tenantId: identity.tenantId,
      });
      recordAuditEvent({
        action: "execution.responses_async_enqueued",
        apiKeyId: identity.apiKeyId,
        details: {
          run_id: jobId,
          source,
          tool: toolId,
        },
        method: "POST",
        outcome: "allowed",
        route: "/api/v1/responses",
        tenantId: identity.tenantId,
      });
    } catch {
      quota.lease.release();
      return Response.json(
        {
          error: {
            code: "enqueue_error",
            message: "Failed to enqueue response execution.",
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
            message: "Failed to enqueue response execution.",
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

          const execution = await executeTool(toolId, params);
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
            source,
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
        } catch (error) {
          const durationMs = Math.max(1, Date.now() - startedAt);
          const errorCode =
            error instanceof ToolExecutionError
              ? error.code
              : "execution_error";
          const errorMessage =
            error instanceof ToolExecutionError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Async response execution failed.";
          const creditsUsed = resolveCreditsForStatus("failed");
          await toolJobRegistry.markFailed(
            jobId,
            errorCode,
            errorMessage,
            durationMs,
          );
          await runRegistry.markFailed(jobId, errorMessage);
          await appendUsageSafe({
            apiKeyId: identity.apiKeyId,
            creditsUsed,
            durationMs,
            errorCode,
            errorMessage,
            jobId,
            runId: jobId,
            source,
            status: "failed",
            tenantId: identity.tenantId,
            tool: toolId,
          });
          await emitWebhookSafe({
            apiKeyId: identity.apiKeyId,
            creditsUsed,
            durationMs,
            errorCode,
            errorMessage,
            jobId,
            runId: jobId,
            status: "failed",
            tenantId: identity.tenantId,
            tool: toolId,
          });
        } finally {
          quota.lease.release();
        }
      })();
    }, 0);

    return Response.json(
      {
        ...toResponseEnvelope({
          createdAtMs: Date.now(),
          model: body.model,
          responseId: `resp_${jobId}`,
          runId: jobId,
          status: "in_progress",
          tool: toolId,
        }),
        estimated_duration_ms: etaMs,
        job_id: job.jobId,
      },
      {
        headers: {
          "x-run-id": jobId,
        },
      },
    );
  }

  const quota = reserveExecutionQuota(identity);
  if (!quota.ok) {
    return toResponse(quota);
  }

  try {
    await runRegistry.createAccepted(runId, {
      apiKeyId: identity.apiKeyId,
      source,
      tenantId: identity.tenantId,
    });
    await runRegistry.markRunning(runId);
    recordAuditEvent({
      action: "execution.responses_sync_started",
      apiKeyId: identity.apiKeyId,
      details: {
        run_id: runId,
        source,
        tool: toolId,
      },
      method: "POST",
      outcome: "allowed",
      route: "/api/v1/responses",
      tenantId: identity.tenantId,
    });
    const startedAt = Date.now();

    try {
      const execution = await executeTool(toolId, params);
      await runRegistry.markSucceeded(runId);
      const creditsUsed = resolveCreditsForStatus("succeeded");
      await appendUsageSafe({
        apiKeyId: identity.apiKeyId,
        creditsUsed,
        durationMs: execution.durationMs,
        runId,
        source,
        status: "succeeded",
        tenantId: identity.tenantId,
        tool: execution.toolId,
      });

      return Response.json(
        toResponseEnvelope({
          createdAtMs: Date.now(),
          model: body.model,
          outputText: summarizeResultText(execution.result),
          responseId: `resp_${runId}`,
          result: execution.result,
          runId,
          status: "completed",
          tool: execution.toolId,
          usage: {
            credits_used: creditsUsed,
          },
        }),
        {
          headers: {
            "x-run-id": runId,
          },
        },
      );
    } catch (error) {
      const durationMs = Math.max(1, Date.now() - startedAt);
      const errorCode =
        error instanceof ToolExecutionError ? error.code : "execution_error";
      const errorMessage =
        error instanceof ToolExecutionError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Response execution failed.";
      await runRegistry.markFailed(runId, errorMessage);
      await appendUsageSafe({
        apiKeyId: identity.apiKeyId,
        creditsUsed: resolveCreditsForStatus("failed"),
        durationMs,
        errorCode,
        errorMessage,
        runId,
        source,
        status: "failed",
        tenantId: identity.tenantId,
        tool: toolId,
      });

      return Response.json(
        toResponseEnvelope({
          createdAtMs: Date.now(),
          error: {
            code: errorCode,
            message: errorMessage,
          },
          model: body.model,
          responseId: `resp_${runId}`,
          runId,
          status: "failed",
          tool: toolId,
          usage: {
            credits_used: resolveCreditsForStatus("failed"),
          },
        }),
        {
          headers: {
            "x-run-id": runId,
          },
          status: error instanceof ToolExecutionError ? error.status : 500,
        },
      );
    }
  } finally {
    quota.lease.release();
  }
}
