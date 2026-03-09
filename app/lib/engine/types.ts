// @input: Tool manifests + execution params
// @output: Unified types for tool runner, router, and API
// @position: Foundation type definitions for entire v5 engine

/* ── Tool Manifest ── */

export type ToolCategory =
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "convert"
  | "encode"
  | "hash"
  | "generate"
  | "net"
  | "saas.international"
  | "saas.china";

export interface ToolParam {
  name: string;
  type: "string" | "number" | "boolean" | "file" | "color" | "enum";
  required: boolean;
  default?: unknown;
  description: string;
  enum_values?: string[];
  min?: number;
  max?: number;
  accept?: string[]; // file types, e.g. [".pdf", ".docx"]
}

export interface ToolManifest {
  id: string; // e.g. "pdf.compress"
  name: string; // display name
  description: string;
  category: ToolCategory;
  tags: string[];
  params: ToolParam[];
  output_type: "file" | "json" | "text" | "url";
  keywords: string[]; // for zero-token intent matching
  patterns: string[]; // regex patterns for zero-token matching
}

/* ── Execution ── */

export interface ExecuteRequest {
  tool: string;
  params: Record<string, unknown>;
  file_url?: string;
}

export interface ExecuteResult {
  status: "success" | "failed";
  output_url?: string;
  output?: Record<string, unknown>;
  error?: { code: string; message: string; status?: number };
  duration_ms: number;
}

export interface AsyncJob {
  job_id: string;
  tool: string;
  status: "queued" | "running" | "success" | "failed";
  result?: ExecuteResult;
  created_at: string;
}

/* ── Router ── */

export type RouteMatch = {
  tool_id: string;
  confidence: number;
  method: "exact" | "keyword" | "pattern" | "llm";
  tokens_used: number;
};

/* ── Tool Handler ── */

export type ToolHandler = (
  params: Record<string, unknown>,
  fileBuffer?: Buffer,
) => Promise<ExecuteResult>;

export interface ToolRegistryEntry {
  manifest: ToolManifest;
  handler: ToolHandler;
  timeout?: number; // ms; defaults to DEFAULT_TIMEOUT_MS in runner
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const LONG_TIMEOUT_MS = 120_000;  // video.*, pdf.*, media.*
export const FAST_TIMEOUT_MS = 10_000;   // hash.*, encode.*, generate.*
