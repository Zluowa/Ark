export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

export type JsonObject = {
  [key: string]: JsonValue;
};

export type ArkClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  userAgent?: string;
};

export type PlatformContractResponse = JsonObject;

export type ToolRegistryResponse = {
  tools: JsonValue[];
  total: number;
};

export type ExecuteResponse<T = JsonObject> = {
  status: "success";
  tool: string;
  run_id: string;
  result: T;
  duration_ms: number;
  credits_used?: number;
};

export type ExecuteAsyncResponse = {
  job_id: string;
  run_id: string;
  status: string;
  estimated_duration_ms?: number;
};

export type JobResponse<T = JsonObject> = {
  job_id: string;
  run_id: string;
  tool: string;
  status: string;
  progress?: number;
  eta_ms?: number;
  result?: T;
  error?: {
    code: string;
    message: string;
  };
  started_at?: number;
  completed_at?: number;
  duration_ms?: number;
};

export type UploadFileInput = {
  data: Blob | Uint8Array | ArrayBuffer;
  name: string;
  contentType?: string;
  scope?: string;
  fieldName?: "file" | "files";
};

export type UploadResponse = {
  ok: boolean;
  count: number;
  files: Array<{
    name: string;
    size_bytes: number;
    content_type: string;
    executor_url?: string;
    url: string;
    artifact?: JsonObject;
  }>;
};

export type PollJobOptions = {
  intervalMs?: number;
  timeoutMs?: number;
};

export type ApiKeyQuota = {
  burstPerMinute?: number;
  concurrencyLimit?: number;
  monthlyLimit?: number;
};

export type ApiKeyRecord = {
  id: string;
  tenantId: string;
  scopes: string[];
  status: "active" | "revoked";
  source: "env" | "local";
  revocable: boolean;
  keyPreview: string;
  quota?: ApiKeyQuota;
  createdAt?: number;
  createdBy?: string;
  revokedAt?: number;
};

export type ListApiKeysResponse = {
  ok: boolean;
  total: number;
  keys: ApiKeyRecord[];
};

export type CreateApiKeyInput = {
  id?: string;
  key?: string;
  quota?: ApiKeyQuota;
  scopes?: string[];
  tenantId?: string;
};

export type CreateApiKeyResponse = {
  ok: boolean;
  api_key: string;
  key: ApiKeyRecord;
};

export type RevokeApiKeyResponse = {
  ok: boolean;
  key: ApiKeyRecord;
};

export type TenantQuota = ApiKeyQuota;

export type TenantRecord = {
  id: string;
  status: "active" | "suspended";
  createdAt: number;
  updatedAt: number;
  name?: string;
  createdBy?: string;
  quota?: TenantQuota;
};

export type UsageRecord = {
  id: string;
  runId: string;
  jobId?: string;
  tenantId: string;
  apiKeyId: string;
  tool: string;
  source: string;
  status: "succeeded" | "failed" | "cancelled";
  creditsUsed: number;
  createdAt: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type UsageSummaryBucket = {
  from: number;
  to: number;
  totalCredits: number;
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  cancelledRuns: number;
};

export type UsageSummary = {
  asOf: number;
  tenantId: string;
  day: UsageSummaryBucket;
  month: UsageSummaryBucket;
};

export type ListTenantsResponse = {
  ok: boolean;
  total: number;
  tenants: TenantRecord[];
};

export type CreateTenantInput = {
  id: string;
  name?: string;
  quota?: TenantQuota;
};

export type CreateTenantResponse = {
  ok: boolean;
  tenant: TenantRecord;
  bootstrap_api_key: string;
  bootstrap_key: ApiKeyRecord;
};

export type CreateManagedTenantInput = {
  id: string;
  name?: string;
  quota?: TenantQuota;
  tenantKeyId?: string;
  tenantKeyScopes?: string[];
};

export type CreateManagedTenantResponse = {
  ok: boolean;
  service_mode: "managed_ark_key";
  tenant: TenantRecord;
  tenant_api_key: string;
  tenant_key: ApiKeyRecord;
};

export type ManagedTenantListItem = {
  tenant: TenantRecord;
  active_key_count: number;
  total_key_count: number;
};

export type ListManagedTenantsResponse = {
  ok: boolean;
  service_mode: "managed_ark_key";
  total: number;
  tenants: ManagedTenantListItem[];
};

export type GetManagedTenantResponse = {
  ok: boolean;
  service_mode: "managed_ark_key";
  tenant: TenantRecord;
  tenant_keys: ApiKeyRecord[];
  active_key_count: number;
  total_key_count: number;
  usage_summary: UsageSummary;
  usage: UsageRecord[];
};

export type CreateManagedTenantKeyInput = {
  id?: string;
  key?: string;
  quota?: ApiKeyQuota;
  scopes?: string[];
  revokeExisting?: boolean;
};

export type CreateManagedTenantKeyResponse = {
  ok: boolean;
  service_mode: "managed_ark_key";
  tenant_api_key: string;
  tenant_key: ApiKeyRecord;
};

export type RevokeManagedTenantKeyResponse = {
  ok: boolean;
  service_mode: "managed_ark_key";
  tenant_key: ApiKeyRecord;
};

export type UpdateTenantInput = {
  name?: string;
  quota?: TenantQuota;
  status?: "active" | "suspended";
};

export type GetTenantResponse = {
  ok: boolean;
  tenant: TenantRecord;
};

const defaultFetch = globalThis.fetch.bind(globalThis);

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const toBlob = (
  data: Blob | Uint8Array | ArrayBuffer,
  contentType?: string,
): Blob => {
  if (data instanceof Blob) {
    return data;
  }
  if (data instanceof Uint8Array) {
    const view = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    return new Blob([view], {
      type: contentType ?? "application/octet-stream",
    });
  }
  return new Blob([new Uint8Array(data)], {
    type: contentType ?? "application/octet-stream",
  });
};

const parseErrorBody = async (res: Response): Promise<{
  code?: string;
  message?: string;
  details?: unknown;
}> => {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    return {
      code: body?.error?.code,
      message: body?.error?.message,
      details: body?.error?.details,
    };
  } catch {
    return {
      message: res.statusText || "Request failed",
    };
  }
};

export class ArkApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ArkApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ArkClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: ArkClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.userAgent = options.userAgent ?? "@ark/client/0.1.0";
  }

  static fromEnv(
    env: Record<string, string | undefined> = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env ?? {},
    overrides: Partial<ArkClientOptions> = {},
  ): ArkClient {
    return new ArkClient({
      baseUrl: overrides.baseUrl ?? env.ARK_BASE_URL ?? env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010",
      apiKey: overrides.apiKey ?? env.ARK_API_KEY ?? env.OMNIAGENT_API_KEY,
      fetch: overrides.fetch,
      userAgent: overrides.userAgent,
    });
  }

  async getPlatform(): Promise<PlatformContractResponse> {
    return this.requestJson<PlatformContractResponse>("/api/v1/platform", {
      method: "GET",
      auth: false,
    });
  }

  async listTools(): Promise<ToolRegistryResponse> {
    return this.requestJson<ToolRegistryResponse>("/api/v1/tools/registry", {
      method: "GET",
      auth: false,
    });
  }

  async execute<T = JsonObject>(
    tool: string,
    params: Record<string, unknown> = {},
  ): Promise<ExecuteResponse<T>> {
    return this.requestJson<ExecuteResponse<T>>("/api/v1/execute", {
      method: "POST",
      body: JSON.stringify({ tool, params }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async executeAsync(
    tool: string,
    params: Record<string, unknown> = {},
  ): Promise<ExecuteAsyncResponse> {
    return this.requestJson<ExecuteAsyncResponse>("/api/v1/execute/async", {
      method: "POST",
      body: JSON.stringify({ tool, params }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async getJob<T = JsonObject>(jobId: string): Promise<JobResponse<T>> {
    return this.requestJson<JobResponse<T>>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
      },
    );
  }

  async pollJob<T = JsonObject>(
    jobId: string,
    options: PollJobOptions = {},
  ): Promise<JobResponse<T>> {
    const intervalMs = options.intervalMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? 60000;
    const startedAt = Date.now();

    while (true) {
      const job = await this.getJob<T>(jobId);
      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
        return job;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new ArkApiError(
          408,
          `Timed out waiting for job ${jobId} after ${timeoutMs}ms.`,
          "job_poll_timeout",
        );
      }
      await sleep(intervalMs);
    }
  }

  async uploadFile(input: UploadFileInput): Promise<UploadResponse> {
    const formData = new FormData();
    if (input.scope) {
      formData.set("scope", input.scope);
    }
    formData.append(
      input.fieldName ?? "file",
      toBlob(input.data, input.contentType),
      input.name,
    );
    return this.requestJson<UploadResponse>("/api/v1/files", {
      method: "POST",
      body: formData,
    });
  }

  async listApiKeys(tenantId?: string): Promise<ListApiKeysResponse> {
    const query = tenantId
      ? `?tenant_id=${encodeURIComponent(tenantId)}`
      : "";
    return this.requestJson<ListApiKeysResponse>(
      `/api/v1/admin/api-keys${query}`,
      {
        method: "GET",
      },
    );
  }

  async createApiKey(
    input: CreateApiKeyInput = {},
  ): Promise<CreateApiKeyResponse> {
    return this.requestJson<CreateApiKeyResponse>("/api/v1/admin/api-keys", {
      method: "POST",
      body: JSON.stringify({
        ...(input.id ? { id: input.id } : {}),
        ...(input.key ? { key: input.key } : {}),
        ...(input.quota ? { quota: input.quota } : {}),
        ...(input.scopes ? { scopes: input.scopes } : {}),
        ...(input.tenantId ? { tenant_id: input.tenantId } : {}),
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async revokeApiKey(keyId: string): Promise<RevokeApiKeyResponse> {
    return this.requestJson<RevokeApiKeyResponse>(
      `/api/v1/admin/api-keys/${encodeURIComponent(keyId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async listTenants(): Promise<ListTenantsResponse> {
    return this.requestJson<ListTenantsResponse>("/api/v1/admin/tenants", {
      method: "GET",
    });
  }

  async createTenant(input: CreateTenantInput): Promise<CreateTenantResponse> {
    return this.requestJson<CreateTenantResponse>("/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        ...(input.name ? { name: input.name } : {}),
        ...(input.quota ? { quota: input.quota } : {}),
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async createManagedTenant(
    input: CreateManagedTenantInput,
  ): Promise<CreateManagedTenantResponse> {
    return this.requestJson<CreateManagedTenantResponse>(
      "/api/v1/admin/managed-tenants",
      {
        method: "POST",
        body: JSON.stringify({
          id: input.id,
          ...(input.name ? { name: input.name } : {}),
          ...(input.quota ? { quota: input.quota } : {}),
          ...(input.tenantKeyId ? { tenant_key_id: input.tenantKeyId } : {}),
          ...(input.tenantKeyScopes
            ? { tenant_key_scopes: input.tenantKeyScopes }
            : {}),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }

  async listManagedTenants(): Promise<ListManagedTenantsResponse> {
    return this.requestJson<ListManagedTenantsResponse>(
      "/api/v1/admin/managed-tenants",
      {
        method: "GET",
      },
    );
  }

  async getManagedTenant(
    tenantId: string,
    options: { limit?: number } = {},
  ): Promise<GetManagedTenantResponse> {
    const query =
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? `?limit=${Math.max(1, Math.min(500, Math.floor(options.limit)))}`
        : "";
    return this.requestJson<GetManagedTenantResponse>(
      `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}${query}`,
      {
        method: "GET",
      },
    );
  }

  async updateManagedTenant(
    tenantId: string,
    input: UpdateTenantInput,
  ): Promise<{ ok: boolean; service_mode: "managed_ark_key"; tenant: TenantRecord }> {
    return this.requestJson<{
      ok: boolean;
      service_mode: "managed_ark_key";
      tenant: TenantRecord;
    }>(
      `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.quota !== undefined ? { quota: input.quota } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }

  async createManagedTenantKey(
    tenantId: string,
    input: CreateManagedTenantKeyInput = {},
  ): Promise<CreateManagedTenantKeyResponse> {
    return this.requestJson<CreateManagedTenantKeyResponse>(
      `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}/keys`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(input.id ? { id: input.id } : {}),
          ...(input.key ? { key: input.key } : {}),
          ...(input.quota ? { quota: input.quota } : {}),
          ...(input.scopes ? { scopes: input.scopes } : {}),
          ...(input.revokeExisting ? { revoke_existing: true } : {}),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }

  async revokeManagedTenantKey(
    tenantId: string,
    keyId: string,
  ): Promise<RevokeManagedTenantKeyResponse> {
    return this.requestJson<RevokeManagedTenantKeyResponse>(
      `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}/keys/${encodeURIComponent(keyId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async getTenant(tenantId: string): Promise<GetTenantResponse> {
    return this.requestJson<GetTenantResponse>(
      `/api/v1/admin/tenants/${encodeURIComponent(tenantId)}`,
      {
        method: "GET",
      },
    );
  }

  async updateTenant(
    tenantId: string,
    input: UpdateTenantInput,
  ): Promise<GetTenantResponse> {
    return this.requestJson<GetTenantResponse>(
      `/api/v1/admin/tenants/${encodeURIComponent(tenantId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.quota !== undefined ? { quota: input.quota } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        }),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }

  private async requestJson<T>(
    path: string,
    options: {
      method: string;
      body?: BodyInit;
      headers?: Record<string, string>;
      auth?: boolean;
    },
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Ark-Client", this.userAgent);
    if ((options.auth ?? true) && this.apiKey) {
      headers.set("X-API-Key", this.apiKey);
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method,
      body: options.body,
      headers,
    });
    if (!response.ok) {
      const parsed = await parseErrorBody(response);
      throw new ArkApiError(
        response.status,
        parsed.message ?? `Request failed with status ${response.status}`,
        parsed.code,
        parsed.details,
      );
    }
    return (await response.json()) as T;
  }
}
