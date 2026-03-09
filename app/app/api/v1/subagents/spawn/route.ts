import { randomUUID } from "node:crypto";
import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import {
  emitJobTerminalWebhook,
  type JobTerminalWebhookInput,
} from "@/lib/server/billing-webhook";
import { resolveCreditsForStatus } from "@/lib/server/billing-policy";
import { reserveExecutionQuota } from "@/lib/server/quota-governor";
import { runRegistry } from "@/lib/server/run-registry";
import {
  subagentRegistry,
  type SubagentRecord,
} from "@/lib/server/subagent-registry";
import { getToolById } from "@/lib/server/tool-catalog";
import { executeTool, ToolExecutionError } from "@/lib/server/tool-executor";
import { usageLedger, type UsageWriteInput } from "@/lib/server/usage-ledger";
import {
  enforceWriteRateLimit,
  parseJsonBodyWithLimit,
  recordAuditEvent,
} from "@/lib/server/security-controls";

type SpawnBody = {
  params?: Record<string, unknown>;
  requested_scopes?: unknown;
  scopes?: unknown;
  source?: string;
  spawned_by?: string;
  tool?: string;
};

const MAX_SUBAGENT_SPAWN_DEPTH = 16;

const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const normalizeScopes = (scopes: readonly string[]): string[] => {
  const deduped = new Set<string>();
  for (const scope of scopes) {
    const normalized = scope.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return [...deduped];
};

const hasScope = (
  effectiveScopes: readonly string[],
  required: string,
): boolean => {
  const normalizedRequired = required.trim().toLowerCase();
  if (!normalizedRequired) {
    return false;
  }
  return (
    effectiveScopes.includes("admin:*") ||
    effectiveScopes.includes(normalizedRequired)
  );
};

const parseRequestedScopes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const scopes = normalizeScopes(
    value.filter((item): item is string => typeof item === "string"),
  );
  return scopes.length > 0 ? scopes : [];
};

const resolveSource = (req: Request, body: SpawnBody): string => {
  const fromBody = body.source?.trim();
  if (fromBody) {
    return fromBody;
  }
  const fromHeader =
    req.headers.get("x-omni-source")?.trim() ||
    req.headers.get("x-source")?.trim();
  if (fromHeader) {
    return fromHeader;
  }
  return "api.v1.subagents.spawn";
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
      `[billing] webhook dispatch failed for subagent ${payload.jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const toSubagentShape = (
  subagent: SubagentRecord,
  status: string | undefined,
): Record<string, unknown> => {
  return {
    id: subagent.id,
    run_id: subagent.runId,
    tool: subagent.tool,
    status: status ?? "accepted",
    tenant_id: subagent.tenantId,
    api_key_id: subagent.apiKeyId,
    spawned_by: subagent.spawnedBy,
    spawn_depth: subagent.spawnDepth,
    effective_scopes: subagent.effectiveScopes,
    created_at: subagent.createdAt,
  };
};

export async function POST(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) {
    return toResponse(access);
  }
  const identity = access.identity;
  const rateLimitResponse = enforceWriteRateLimit(
    identity,
    "/api/v1/subagents/spawn",
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  const parsedBody = await parseJsonBodyWithLimit<SpawnBody>(req, {
    route: "/api/v1/subagents/spawn",
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
  if (!getToolById(tool)) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: `Tool not found: ${tool}`,
        },
      },
      { status: 404 },
    );
  }

  const parentId =
    typeof body.spawned_by === "string" ? body.spawned_by.trim() : "";
  let parentSubagent: SubagentRecord | undefined;
  if (parentId) {
    parentSubagent = await subagentRegistry.get(parentId);
    if (!parentSubagent) {
      return Response.json(
        {
          error: {
            code: "not_found",
            message: `Subagent not found: ${parentId}`,
          },
        },
        { status: 404 },
      );
    }
    if (!canAccessTenant(identity, parentSubagent.tenantId)) {
      return tenantBlockedResponse("Subagent", parentId);
    }
  }

  const spawnDepth = parentSubagent ? parentSubagent.spawnDepth + 1 : 0;
  if (spawnDepth > MAX_SUBAGENT_SPAWN_DEPTH) {
    return Response.json(
      {
        error: {
          code: "subagent_depth_exceeded",
          message: `Max subagent spawn depth exceeded (${MAX_SUBAGENT_SPAWN_DEPTH})`,
        },
      },
      { status: 400 },
    );
  }

  const inheritedScopes = normalizeScopes(
    parentSubagent
      ? parentSubagent.effectiveScopes
      : [...identity.scopes.values()],
  );
  if (parentSubagent && !hasScope(inheritedScopes, "execute:write")) {
    return Response.json(
      {
        error: {
          code: "subagent_parent_scope_forbidden",
          message:
            "Parent subagent does not have execute:write permission to spawn children.",
        },
      },
      { status: 403 },
    );
  }

  const requestedScopes =
    parseRequestedScopes(body.requested_scopes) ??
    parseRequestedScopes(body.scopes);
  const effectiveScopes =
    requestedScopes === undefined
      ? inheritedScopes
      : requestedScopes.filter((scope) => hasScope(inheritedScopes, scope));
  if (
    requestedScopes &&
    requestedScopes.length > 0 &&
    effectiveScopes.length < 1
  ) {
    return Response.json(
      {
        error: {
          code: "subagent_scope_forbidden",
          message: "Requested scopes exceed inherited policy.",
          inherited_scopes: inheritedScopes,
        },
      },
      { status: 403 },
    );
  }

  const source = resolveSource(req, body);
  const quota = reserveExecutionQuota(identity);
  if (!quota.ok) {
    return toResponse(quota);
  }

  const runId = randomUUID();
  const tenantId = parentSubagent?.tenantId ?? identity.tenantId;
  const params = asObject(body.params);
  const etaMs = estimateDurationMs(tool);

  let subagent: SubagentRecord | undefined;
  try {
    await runRegistry.createAccepted(runId, {
      apiKeyId: identity.apiKeyId,
      source,
      tenantId,
      spawnedBy: parentSubagent?.id,
      spawnDepth,
    });
    subagent = await subagentRegistry.create({
      apiKeyId: identity.apiKeyId,
      effectiveScopes,
      runId,
      spawnedBy: parentSubagent?.id,
      spawnDepth,
      tenantId,
      tool,
    });
    recordAuditEvent({
      action: "execution.subagent_spawned",
      apiKeyId: identity.apiKeyId,
      details: {
        run_id: runId,
        spawn_depth: spawnDepth,
        subagent_id: subagent.id,
        tool,
      },
      method: "POST",
      outcome: "allowed",
      route: "/api/v1/subagents/spawn",
      tenantId,
    });
  } catch (error) {
    await runRegistry.markFailed(runId, "subagent registration failed");
    quota.lease.release();
    return Response.json(
      {
        error: {
          code: "spawn_error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create subagent.",
        },
      },
      { status: 500 },
    );
  }

  setTimeout(() => {
    void (async () => {
      const startedAt = Date.now();
      try {
        await runRegistry.markRunning(runId);
        const execution = await executeTool(tool, params);
        await runRegistry.markSucceeded(runId);
        const creditsUsed = resolveCreditsForStatus("succeeded");
        await appendUsageSafe({
          apiKeyId: identity.apiKeyId,
          creditsUsed,
          durationMs: execution.durationMs,
          jobId: subagent.id,
          runId,
          source,
          status: "succeeded",
          tenantId,
          tool: execution.toolId,
        });
        await emitWebhookSafe({
          apiKeyId: identity.apiKeyId,
          creditsUsed,
          durationMs: execution.durationMs,
          jobId: subagent.id,
          runId,
          status: "succeeded",
          tenantId,
          tool: execution.toolId,
        });
      } catch (error) {
        const durationMs = Math.max(1, Date.now() - startedAt);
        const errorCode =
          error instanceof ToolExecutionError ? error.code : "execution_error";
        const errorMessage =
          error instanceof ToolExecutionError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Subagent execution failed.";
        await runRegistry.markFailed(runId, errorMessage);
        const creditsUsed = resolveCreditsForStatus("failed");
        await appendUsageSafe({
          apiKeyId: identity.apiKeyId,
          creditsUsed,
          durationMs,
          errorCode,
          errorMessage,
          jobId: subagent.id,
          runId,
          source,
          status: "failed",
          tenantId,
          tool,
        });
        await emitWebhookSafe({
          apiKeyId: identity.apiKeyId,
          creditsUsed,
          durationMs,
          errorCode,
          errorMessage,
          jobId: subagent.id,
          runId,
          status: "failed",
          tenantId,
          tool,
        });
      } finally {
        quota.lease.release();
      }
    })();
  }, 0);

  return Response.json({
    ok: true,
    subagent_id: subagent.id,
    run_id: subagent.runId,
    estimated_duration_ms: etaMs,
    subagent: toSubagentShape(subagent, "accepted"),
  });
}
