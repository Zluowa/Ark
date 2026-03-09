// @input: tool ID + params from API callers
// @output: ExecuteToolResult via v5 engine (real) or remote executor (fallback)
// @position: Execution adapter — bridges /api/v1/execute to v5 engine

import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { extname } from "node:path";
import { artifactStore } from "@/lib/server/artifact-store";
import { initEngine } from "@/lib/engine/init";
import { execute } from "@/lib/engine/runner";
import { toolRegistry } from "@/lib/engine/registry";
import { DEFAULT_TIMEOUT_MS } from "@/lib/engine/types";

export type ExecuteToolResult = {
  toolId: string;
  durationMs: number;
  result: Record<string, unknown>;
};

export class ToolExecutionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
    this.status = status;
  }
}

/* ── ID normalization ── */

const TOOL_ALIASES: Record<string, string> = {
  pdf_compress: "pdf.compress",
  pdf_merge: "pdf.merge",
  pdf_split: "pdf.split",
  image_compress: "image.compress",
  image_convert: "image.convert",
  image_crop: "image.crop",
  video_transcode: "video.convert",
  video_extract_audio: "video.extract_audio",
  video_clip: "video.trim",
  json_format: "convert.json_format",
  "official.pdf.compress": "pdf.compress",
  "official.pdf.merge": "pdf.merge",
  "official.pdf.split": "pdf.split",
  "official.image.compress": "image.compress",
  "official.image.convert": "image.convert",
  "official.image.crop": "image.crop",
  "official.video.transcode": "video.convert",
  "official.video.extract_audio": "video.extract_audio",
  "official.video.clip": "video.trim",
  "official.utility.json_format": "convert.json_format",
  "official.utility.json-format": "convert.json_format",
  "official.video.extract-audio": "video.extract_audio",
};

const normalizeToolId = (tool: string): string => {
  const normalized = tool.trim();
  if (!normalized) return normalized;
  const alias = TOOL_ALIASES[normalized.toLowerCase()];
  return alias ?? normalized;
};

const toV5Id = (id: string): string => id.replace(/^official\./, "");

/* ── Helpers ── */

const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const asNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return normalized.length ? normalized : undefined;
};

const firstString = (params: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = asString(params[key]);
    if (value) return value;
  }
  return undefined;
};

const firstStringArray = (params: Record<string, unknown>, keys: string[]): string[] | undefined => {
  for (const key of keys) {
    const value = asStringArray(params[key]);
    if (value) return value;
  }
  return undefined;
};

const normalizeParamsForTool = (
  toolId: string,
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const params: Record<string, unknown> = { ...raw };

  if (params.file_url === undefined) {
    const fileUrl = firstString(params, [
      "file",
      "fileUrl",
      "input_file",
      "inputFile",
      "source_file",
      "url",
    ]);
    if (fileUrl) params.file_url = fileUrl;
  }

  if (params.file_urls === undefined) {
    const fileUrls = firstStringArray(params, ["files", "fileUrls", "urls"]);
    if (fileUrls) params.file_urls = fileUrls;
  }

  const normalizedFormat = firstString(params, [
    "format",
    "target_format",
    "targetFormat",
    "output_format",
    "outputFormat",
  ]);
  if (normalizedFormat && params.format === undefined) {
    params.format = normalizedFormat.toLowerCase();
  }

  if (toolId === "convert.json_format" && params.input === undefined) {
    const text = firstString(params, ["text", "json"]);
    if (text) params.input = text;
  }

  if (toolId === "pdf.merge" && params.file_urls === undefined) {
    const urls = firstStringArray(params, ["file_list", "fileList"]);
    if (urls) params.file_urls = urls;
  }

  if (toolId === "pdf.split" && params.ranges === undefined) {
    const from = asNumber(params.from_page, NaN);
    const to = asNumber(params.to_page, NaN);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      params.ranges = `${Math.max(1, Math.floor(from))}-${Math.max(1, Math.floor(to))}`;
    } else if (Number.isFinite(from)) {
      params.ranges = `${Math.max(1, Math.floor(from))}-`;
    }
  }

  if (toolId === "video.trim") {
    if (params.start === undefined) {
      const startSeconds = asNumber(params.start_seconds, NaN);
      if (Number.isFinite(startSeconds) && startSeconds >= 0) {
        params.start = String(startSeconds);
      }
    }
    if (params.end === undefined) {
      const endSeconds = asNumber(params.end_seconds, NaN);
      if (Number.isFinite(endSeconds) && endSeconds >= 0) {
        params.end = String(endSeconds);
      }
    }
  }

  if (toolId === "image.convert") {
    const imageFormat = asString(params.format)?.toLowerCase();
    if (imageFormat === "jpeg") {
      params.format = "jpg";
    }
  }

  return params;
};

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  json: "application/json",
};

/* ── Artifact upload (local file → S3) ── */

const uploadFileArtifact = async (
  toolId: string,
  localPath: string,
): Promise<string | undefined> => {
  if (!existsSync(localPath)) return undefined;
  const ext = extname(localPath).replace(/^\./, "") || "bin";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  try {
    const buffer = readFileSync(localPath);
    const artifact = await artifactStore.persist({
      body: buffer,
      contentType,
      extension: ext,
      toolId,
    });
    if (artifact?.url) {
      try { unlinkSync(localPath); } catch { /* best-effort */ }
      return artifact.url;
    }
    // noop store: register file for HTTP serving instead of deleting it
    const { register } = await import("@/lib/server/local-file-store");
    return register(localPath);
  } catch (err) {
    console.error("[tool-executor] uploadFileArtifact failed:", err);
    try {
      const { register } = await import("@/lib/server/local-file-store");
      return register(localPath);
    } catch (fallbackErr) {
      console.error("[tool-executor] local-file-store fallback failed:", fallbackErr);
      return undefined;
    }
  }
};

/* ── Remote executor (E2B sandbox fallback) ── */

type RemoteExecutionResponse = {
  status?: string;
  tool?: string;
  result?: unknown;
  duration_ms?: number;
  error?: { code?: string; message?: string };
};

const getExecutorBaseUrl = (): string | undefined => {
  const raw = process.env.OMNIAGENT_EXECUTOR_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
};

const executeViaRemote = async (
  toolId: string,
  params: Record<string, unknown>,
): Promise<ExecuteToolResult> => {
  const baseUrl = getExecutorBaseUrl();
  if (!baseUrl) {
    throw new ToolExecutionError("executor_unconfigured", "Executor service URL is not configured", 500);
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: toolId, params }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    if (isAbort) throw new ToolExecutionError("TOOL_TIMEOUT", `Remote executor timed out after ${DEFAULT_TIMEOUT_MS}ms`, 504);
    const msg = error instanceof Error ? error.message : "Executor service unavailable";
    throw new ToolExecutionError("executor_unreachable", msg, 502);
  } finally {
    clearTimeout(timer);
  }

  let body: RemoteExecutionResponse | undefined;
  try { body = (await res.json()) as RemoteExecutionResponse; } catch { body = undefined; }

  if (!res.ok) {
    const code = body?.error?.code?.trim() || "executor_error";
    const msg = body?.error?.message?.trim() || `Executor request failed with status ${res.status}`;
    throw new ToolExecutionError(code, msg, res.status);
  }
  if (body?.status === "failed") {
    const code = body.error?.code?.trim() || "executor_failed";
    const msg = body.error?.message?.trim() || "Executor reported failed status";
    throw new ToolExecutionError(code, msg, 400);
  }

  return {
    toolId: typeof body?.tool === "string" && body.tool.trim() ? normalizeToolId(body.tool) : toolId,
    durationMs: Math.max(1, Math.floor(asNumber(body?.duration_ms, Date.now() - startedAt))),
    result: asObject(body?.result),
  };
};

/* ── Main entry point ── */

export const executeTool = async (
  tool: string,
  rawParams: unknown,
  context?: { tenantId?: string },
): Promise<ExecuteToolResult> => {
  const normalized = normalizeToolId(tool);
  if (!normalized) {
    throw new ToolExecutionError("bad_request", "Missing tool id", 400);
  }

  const inputParams = asObject(rawParams);
  initEngine();

  const v5Id = toV5Id(normalized);
  const params = normalizeParamsForTool(v5Id, inputParams);
  const entry = toolRegistry.get(v5Id);

  if (entry) {
    const v5Result = await execute(v5Id, params, undefined, context);
    if (v5Result.status === "failed") {
      const httpStatus = v5Result.error?.status ?? (v5Result.error?.code === "TOOL_TIMEOUT" ? 504 : 400);
      throw new ToolExecutionError(
        v5Result.error?.code ?? "execution_error",
        v5Result.error?.message ?? "Tool execution failed",
        httpStatus,
      );
    }
    const result: Record<string, unknown> = { ...v5Result.output };
    if (v5Result.output_url) {
      if (v5Result.output_url.startsWith("http")) {
        result.output_file_url = v5Result.output_url;
      } else {
        const url = await uploadFileArtifact(v5Id, v5Result.output_url);
        if (url) result.output_file_url = url;
      }
    }
    return { toolId: v5Id, durationMs: v5Result.duration_ms, result };
  }

  if (getExecutorBaseUrl()) {
    return executeViaRemote(normalized, params);
  }

  throw new ToolExecutionError("tool_not_found", `Tool not found: ${normalized}`, 404);
};
