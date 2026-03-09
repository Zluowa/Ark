import { publicEnv } from "@/lib/config/public-env";

export type ToolRuntime = {
  language?: string;
  timeout?: number;
  memory?: string;
};

export type ToolSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  runtime: ToolRuntime;
};

type ToolManifestIoField = {
  name: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  accepts?: string[];
  accept?: string[];
  min?: number;
  max?: number;
  description?: string;
};

type ToolManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  params?: ToolManifestIoField[];
  io?: {
    inputs?: ToolManifestIoField[];
    outputs?: ToolManifestIoField[];
  };
};

export type ToolDetail = ToolSummary & {
  manifest: ToolManifest;
  uiConfig?: Record<string, unknown>;
  hasExecutor: boolean;
  testCaseCount: number;
};

export type ToolExecutionSuccess = {
  status: "success";
  tool: string;
  run_id: string;
  result: Record<string, unknown>;
  duration_ms: number;
  credits_used?: number;
};

export type ToolExecutionFailure = {
  status: "failed";
  run_id: string;
  error: {
    code: string;
    message: string;
  };
};

export type ToolExecutionResponse = ToolExecutionSuccess | ToolExecutionFailure;

export type ToolAsyncEnqueueResponse = {
  job_id: string;
  run_id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  estimated_duration_ms?: number;
};

export type ToolJobResponse = {
  job_id: string;
  run_id: string;
  tool: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  eta_ms?: number;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  started_at?: number;
  completed_at?: number;
  duration_ms?: number;
};

export type ToolUploadedFile = {
  name: string;
  size_bytes: number;
  content_type: string;
  executor_url?: string;
  url: string;
  artifact?: {
    bucket: string;
    content_type: string;
    expires_at: number;
    key: string;
    size_bytes: number;
    storage: "s3";
  };
};

export type BillingUsageStatus = "succeeded" | "failed" | "cancelled";

export type BillingUsageRecord = {
  id: string;
  runId: string;
  jobId?: string;
  tenantId: string;
  apiKeyId: string;
  tool: string;
  source: string;
  status: BillingUsageStatus;
  durationMs?: number;
  creditsUsed: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
};

export type BillingSummaryBucket = {
  cancelledRuns: number;
  failedRuns: number;
  from: number;
  succeededRuns: number;
  to: number;
  totalCredits: number;
  totalRuns: number;
};

export type BillingSummary = {
  asOf: number;
  day: BillingSummaryBucket;
  month: BillingSummaryBucket;
  tenantId: string;
};

const withControlPlaneBase = (path: string): string => {
  const base = publicEnv.controlPlaneBaseUrl?.replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
};

const withApiKeyHeader = (headers?: HeadersInit): Headers => {
  const merged = new Headers(headers);
  const apiKey = publicEnv.apiKey?.trim();
  if (apiKey) {
    merged.set("x-api-key", apiKey);
  }
  return merged;
};

const ensureOk = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as {
        error?: { message?: string };
        message?: string;
      };
      const details = body.error?.message ?? body.message;
      if (details) {
        message = `${message}: ${details}`;
      }
    } catch {
      // ignore json parse errors and keep fallback message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
};

type ListToolsResponse = {
  ok: boolean;
  tools: ToolSummary[];
};

export const listToolSummaries = async (
  query?: string,
): Promise<ToolSummary[]> => {
  const params = new URLSearchParams();
  params.set("limit", "200");
  if (query?.trim()) {
    params.set("q", query.trim());
  }

  const res = await fetch(withControlPlaneBase(`/api/v1/tools?${params}`), {
    cache: "no-store",
    headers: withApiKeyHeader(),
  });
  const body = await ensureOk<ListToolsResponse>(res);
  return Array.isArray(body.tools) ? body.tools : [];
};

type ToolDetailResponse = {
  ok: boolean;
  tool: ToolDetail;
};

export const getToolDetail = async (toolId: string): Promise<ToolDetail> => {
  const encodedToolId = encodeURIComponent(toolId);
  const res = await fetch(
    withControlPlaneBase(`/api/v1/tools/${encodedToolId}`),
    {
      cache: "no-store",
      headers: withApiKeyHeader(),
    },
  );
  const body = await ensureOk<ToolDetailResponse>(res);
  return body.tool;
};

export const executeToolSync = async (
  toolId: string,
  params: Record<string, unknown>,
): Promise<ToolExecutionResponse> => {
  const res = await fetch(withControlPlaneBase("/api/v1/execute"), {
    method: "POST",
    headers: withApiKeyHeader({ "content-type": "application/json" }),
    body: JSON.stringify({
      tool: toolId,
      params,
    }),
  });

  return (await res.json()) as ToolExecutionResponse;
};

export const executeToolAsync = async (
  toolId: string,
  params: Record<string, unknown>,
): Promise<ToolAsyncEnqueueResponse> => {
  const res = await fetch(withControlPlaneBase("/api/v1/execute/async"), {
    method: "POST",
    headers: withApiKeyHeader({ "content-type": "application/json" }),
    body: JSON.stringify({
      tool: toolId,
      params,
    }),
  });

  return await ensureOk<ToolAsyncEnqueueResponse>(res);
};

export const getToolJob = async (jobId: string): Promise<ToolJobResponse> => {
  const encodedJobId = encodeURIComponent(jobId);
  const res = await fetch(
    withControlPlaneBase(`/api/v1/jobs/${encodedJobId}`),
    {
      cache: "no-store",
      headers: withApiKeyHeader(),
    },
  );
  return await ensureOk<ToolJobResponse>(res);
};

type UploadFilesResponse = {
  ok: boolean;
  count: number;
  files: ToolUploadedFile[];
};

type BillingUsageListResponse = {
  ok: boolean;
  count: number;
  usage: BillingUsageRecord[];
};

type BillingSummaryResponse = {
  ok: boolean;
  summary: BillingSummary;
};

export const uploadToolInputFiles = async (
  files: readonly File[],
  scope?: string,
): Promise<ToolUploadedFile[]> => {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  if (scope?.trim()) {
    formData.set("scope", scope.trim());
  }

  const res = await fetch(withControlPlaneBase("/api/v1/files"), {
    method: "POST",
    headers: withApiKeyHeader(),
    body: formData,
  });
  const body = await ensureOk<UploadFilesResponse>(res);
  return Array.isArray(body.files) ? body.files : [];
};

export const listBillingUsage = async (
  limit = 50,
): Promise<BillingUsageRecord[]> => {
  const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const res = await fetch(
    withControlPlaneBase(`/api/v1/billing/usage?limit=${boundedLimit}`),
    {
      cache: "no-store",
      headers: withApiKeyHeader(),
    },
  );
  const body = await ensureOk<BillingUsageListResponse>(res);
  return Array.isArray(body.usage) ? body.usage : [];
};

export const getBillingSummary = async (): Promise<BillingSummary> => {
  const res = await fetch(withControlPlaneBase("/api/v1/billing/summary"), {
    cache: "no-store",
    headers: withApiKeyHeader(),
  });
  const body = await ensureOk<BillingSummaryResponse>(res);
  return body.summary;
};
