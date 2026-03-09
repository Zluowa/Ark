// @input: toolId + params + optional fileBuffer from callers
// @output: ExecuteResult with status, output, and duration_ms
// @position: Execution layer — validates params, runs handler, wraps errors

import type { ExecuteResult, ToolParam } from "./types";
import { DEFAULT_TIMEOUT_MS } from "./types";
import { toolRegistry } from "./registry";

const isMissing = (value: unknown): boolean => {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
};

const validateParams = (
  params: ToolParam[],
  input: Record<string, unknown>,
): string | undefined => {
  for (const param of params) {
    if (param.required && isMissing(input[param.name])) {
      return `Missing required param: ${param.name}`;
    }
  }
  return undefined;
};

export const execute = async (
  toolId: string,
  params: Record<string, unknown>,
  fileBuffer?: Buffer,
  context?: { tenantId?: string },
): Promise<ExecuteResult> => {
  const entry = toolRegistry.get(toolId);
  if (!entry) {
    return {
      status: "failed",
      error: { code: "tool_not_found", message: `Tool not found: ${toolId}` },
      duration_ms: 0,
    };
  }

  const validationError = validateParams(entry.manifest.params, params);
  if (validationError) {
    return {
      status: "failed",
      error: { code: "validation_error", message: validationError },
      duration_ms: 0,
    };
  }

  const startedAt = Date.now();
  const timeoutMs = entry.timeout ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const enriched = context ? { ...params, _context: context } : params;
    const timeoutPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () =>
        reject(new Error(`Tool ${toolId} timed out after ${timeoutMs}ms`))
      );
    });
    const result = await Promise.race([entry.handler(enriched, fileBuffer), timeoutPromise]);
    return { ...result, duration_ms: Math.max(1, Date.now() - startedAt) };
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes("timed out");
    const code = isTimeout ? "TOOL_TIMEOUT" : "execution_error";
    const status = isTimeout ? 504 : undefined;
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return {
      status: "failed",
      error: { code, message, ...(status ? { status } : {}) },
      duration_ms: Math.max(1, Date.now() - startedAt),
    };
  } finally {
    clearTimeout(timer);
  }
};
