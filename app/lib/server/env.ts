const normalize = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const DIRECT_NO_PROXY_ENTRIES = ["127.0.0.1", "localhost", "::1"];

const mergeNoProxyEntries = (...rawLists: Array<string | undefined>): string => {
  const seen = new Set<string>();
  for (const rawList of rawLists) {
    if (!rawList) continue;
    for (const item of rawList.split(",")) {
      const normalized = item.trim();
      if (!normalized) continue;
      seen.add(normalized);
    }
  }
  for (const localEntry of DIRECT_NO_PROXY_ENTRIES) {
    seen.add(localEntry);
  }
  return Array.from(seen).join(",");
};

export const redactSecret = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= 8) {
    return "***";
  }
  return `${normalized.slice(0, 4)}...${normalized.slice(-2)}`;
};

export type AuthMode = "trusted_local" | "api_key";
export type ServiceMode = "self_hosted_byok" | "managed_ark_key";

export type ApiKeyQuotaConfig = {
  burstPerMinute?: number;
  concurrencyLimit?: number;
  monthlyLimit?: number;
};

export type ApiKeyConfig = {
  id: string;
  key: string;
  quota?: ApiKeyQuotaConfig;
  scopes: string[];
  tenantId: string;
};

export type QuotaDefaults = {
  burstPerMinute: number;
  concurrencyLimit: number;
  monthlyLimit: number;
};

export type ServerEnv = {
  auditLogMaxEntries: number;
  apiKeys: ApiKeyConfig[];
  artifactStore: "s3" | "none";
  authMode: AuthMode;
  billingChargeOnFailure: boolean;
  billingCreditsPerExecution: number;
  billingWebhookMaxAttempts: number;
  billingWebhookRetryBaseMs: number;
  billingWebhookSecret?: string;
  billingWebhookTimeoutMs: number;
  billingWebhookUrl?: string;
  databaseUrl?: string;
  executorBaseUrl?: string;
  jobStore: "redis" | "local";
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel: string;
  openaiProtocol: "responses" | "chat";
  observabilityRequestSampleLimit: number;
  observabilityWaitSampleLimit: number;
  redisUrl?: string;
  relayBaseUrl?: string;
  relayApiKey?: string;
  relayModel: string;
  relayProtocol: "responses" | "chat";
  reservedPorts: number[];
  runStore: "postgres" | "local";
  s3AccessKey?: string;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3InternalEndpoint?: string;
  s3Region: string;
  s3SecretKey?: string;
  s3SignedUrlTtlSec: number;
  securityJsonBodyMaxBytes: number;
  securityMultipartBodyMaxBytes: number;
  securityWriteRateLimitPerMinute: number;
  serviceMode: ServiceMode;
  trustedLocalTenantId: string;
  usageStore: "postgres" | "local";
  xhsBridgeUrl: string;
  xhsCookie?: string;
  quotaDefaults: QuotaDefaults;
};

const parseProtocol = (
  value: string | undefined,
  fallback: "responses" | "chat",
): "responses" | "chat" => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "responses" || normalized === "chat") {
    return normalized;
  }
  return fallback;
};

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
): number => {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const parseNonNegativeInt = (
  value: string | undefined,
  fallback: number,
): number => {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
};

const parseOptionalNonNegativeInt = (
  value: string | undefined,
): number | undefined => {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.floor(parsed));
};

const parseAuthMode = (value: string | undefined): AuthMode => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "api_key" || normalized === "strict") {
    return "api_key";
  }
  return "trusted_local";
};

const parseServiceMode = (value: string | undefined): ServiceMode => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "managed_ark_key" || normalized === "managed") {
    return "managed_ark_key";
  }
  return "self_hosted_byok";
};

const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
};

const normalizeScope = (value: string): string => {
  return value.trim().toLowerCase();
};

const parseScopes = (
  value: string | string[] | undefined,
  fallback: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (typeof item === "string" ? normalizeScope(item) : ""))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  if (typeof value === "string") {
    const normalized = value
      .split(",")
      .map((item) => normalizeScope(item))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  return fallback;
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseQuotaConfig = (value: unknown): ApiKeyQuotaConfig | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const monthlyRaw =
    typeof value.monthlyLimit === "number"
      ? value.monthlyLimit
      : typeof value.monthly === "number"
        ? value.monthly
        : typeof value.monthly_limit === "number"
          ? value.monthly_limit
          : undefined;
  const burstRaw =
    typeof value.burstPerMinute === "number"
      ? value.burstPerMinute
      : typeof value.burst === "number"
        ? value.burst
        : typeof value.burst_per_minute === "number"
          ? value.burst_per_minute
          : undefined;
  const concurrencyRaw =
    typeof value.concurrencyLimit === "number"
      ? value.concurrencyLimit
      : typeof value.concurrency === "number"
        ? value.concurrency
        : undefined;

  const monthlyLimit =
    typeof monthlyRaw === "number" && Number.isFinite(monthlyRaw)
      ? Math.max(0, Math.floor(monthlyRaw))
      : undefined;
  const burstPerMinute =
    typeof burstRaw === "number" && Number.isFinite(burstRaw)
      ? Math.max(0, Math.floor(burstRaw))
      : undefined;
  const concurrencyLimit =
    typeof concurrencyRaw === "number" && Number.isFinite(concurrencyRaw)
      ? Math.max(0, Math.floor(concurrencyRaw))
      : undefined;

  if (
    monthlyLimit === undefined &&
    burstPerMinute === undefined &&
    concurrencyLimit === undefined
  ) {
    return undefined;
  }

  return {
    ...(monthlyLimit !== undefined ? { monthlyLimit } : {}),
    ...(burstPerMinute !== undefined ? { burstPerMinute } : {}),
    ...(concurrencyLimit !== undefined ? { concurrencyLimit } : {}),
  };
};

const parseApiKeyEntry = (
  value: unknown,
  index: number,
  fallbackScopes: string[],
): ApiKeyConfig | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const key =
    typeof value.key === "string"
      ? value.key.trim()
      : typeof value.apiKey === "string"
        ? value.apiKey.trim()
        : "";
  if (!key) {
    return undefined;
  }

  const id =
    typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : `key-${index + 1}`;
  const tenantId =
    typeof value.tenantId === "string" && value.tenantId.trim()
      ? value.tenantId.trim()
      : typeof value.tenant === "string" && value.tenant.trim()
        ? value.tenant.trim()
        : "default";
  const scopes = parseScopes(
    Array.isArray(value.scopes)
      ? (value.scopes as string[])
      : typeof value.scopes === "string"
        ? value.scopes
        : undefined,
    fallbackScopes,
  );
  const quota = parseQuotaConfig(value.quota);

  return {
    id,
    key,
    quota,
    scopes,
    tenantId,
  };
};

const parseApiKeysJson = (
  value: string | undefined,
  fallbackScopes: string[],
): ApiKeyConfig[] => {
  if (!value?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const result: ApiKeyConfig[] = [];
    for (let i = 0; i < parsed.length; i += 1) {
      const entry = parseApiKeyEntry(parsed[i], i, fallbackScopes);
      if (entry) {
        result.push(entry);
      }
    }
    return result;
  } catch {
    return [];
  }
};

const dedupeApiKeys = (keys: ApiKeyConfig[]): ApiKeyConfig[] => {
  const seen = new Set<string>();
  const output: ApiKeyConfig[] = [];
  for (const key of keys) {
    if (seen.has(key.key)) {
      continue;
    }
    seen.add(key.key);
    output.push(key);
  }
  return output;
};

export const getServerEnv = (): ServerEnv => {
  const disableProxyByDefault = parseBoolean(
    process.env.OMNIAGENT_DISABLE_PROXY,
    true,
  );
  const mergedNoProxy = mergeNoProxyEntries(
    process.env.NO_PROXY,
    process.env.no_proxy,
  );
  process.env.NO_PROXY = mergedNoProxy;
  process.env.no_proxy = mergedNoProxy;
  if (disableProxyByDefault) {
    for (const key of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ]) {
      delete process.env[key];
    }
  }

  const chatModel =
    normalize(process.env.OMNIAGENT_CHAT_MODEL) ??
    normalize(process.env.OMNIAGENT_RELAY_MODEL ?? process.env.OPENAI_MODEL) ??
    "gemini-3.1-flash-lite-preview";

  const relayBaseUrl = normalize(process.env.OMNIAGENT_RELAY_BASE_URL);
  const relayApiKey = normalize(
    process.env.OMNIAGENT_RELAY_API_KEY ?? process.env.OPENAI_API_KEY,
  );
  const databaseUrl = normalize(process.env.DATABASE_URL);
  const redisUrl = normalize(process.env.REDIS_URL);
  const runStoreHint = normalize(
    process.env.OMNIAGENT_RUN_STORE,
  )?.toLowerCase();
  const jobStoreHint = normalize(
    process.env.OMNIAGENT_JOB_STORE,
  )?.toLowerCase();
  const usageStoreHint = normalize(
    process.env.OMNIAGENT_USAGE_STORE,
  )?.toLowerCase();
  const s3Endpoint = normalize(process.env.S3_ENDPOINT);
  const s3InternalEndpoint =
    normalize(process.env.S3_INTERNAL_ENDPOINT) ??
    normalize(process.env.OMNIAGENT_S3_INTERNAL_ENDPOINT);
  const s3Bucket = normalize(process.env.S3_BUCKET);
  const s3AccessKey = normalize(process.env.S3_ACCESS_KEY);
  const s3SecretKey = normalize(process.env.S3_SECRET_KEY);
  const s3Region = normalize(process.env.S3_REGION) ?? "us-east-1";
  const artifactStoreHint = normalize(
    process.env.OMNIAGENT_ARTIFACT_STORE,
  )?.toLowerCase();
  const s3SignedUrlTtlSec = parsePositiveInt(
    process.env.S3_SIGNED_URL_TTL_SEC,
    3600,
  );
  const authMode = parseAuthMode(process.env.OMNIAGENT_AUTH_MODE);
  const serviceMode = parseServiceMode(process.env.OMNIAGENT_SERVICE_MODE);
  const trustedLocalTenantId =
    normalize(process.env.OMNIAGENT_TRUSTED_LOCAL_TENANT_ID) ?? "local-dev";
  const defaultScopes = parseScopes(process.env.OMNIAGENT_DEFAULT_SCOPES, [
    "execute:read",
    "execute:write",
    "runs:read",
  ]);
  const jsonApiKeys = parseApiKeysJson(
    process.env.OMNIAGENT_API_KEYS_JSON,
    defaultScopes,
  );
  const singleKeyRaw = normalize(process.env.OMNIAGENT_API_KEY);
  const singleKey: ApiKeyConfig | undefined = singleKeyRaw
    ? {
        id: normalize(process.env.OMNIAGENT_API_KEY_ID) ?? "default-key",
        key: singleKeyRaw,
        quota: parseQuotaConfig({
          burstPerMinute: parseOptionalNonNegativeInt(
            process.env.OMNIAGENT_API_KEY_QUOTA_BURST_PER_MINUTE,
          ),
          concurrencyLimit: parseOptionalNonNegativeInt(
            process.env.OMNIAGENT_API_KEY_QUOTA_CONCURRENCY_LIMIT,
          ),
          monthlyLimit: parseOptionalNonNegativeInt(
            process.env.OMNIAGENT_API_KEY_QUOTA_MONTHLY_LIMIT,
          ),
        }),
        scopes: parseScopes(
          process.env.OMNIAGENT_API_KEY_SCOPES,
          defaultScopes,
        ),
        tenantId: normalize(process.env.OMNIAGENT_TENANT_ID) ?? "default",
      }
    : undefined;
  const quotaDefaults: QuotaDefaults = {
    burstPerMinute: parseNonNegativeInt(
      process.env.OMNIAGENT_QUOTA_BURST_PER_MINUTE,
      120,
    ),
    concurrencyLimit: parseNonNegativeInt(
      process.env.OMNIAGENT_QUOTA_CONCURRENCY_LIMIT,
      20,
    ),
    monthlyLimit: parseNonNegativeInt(
      process.env.OMNIAGENT_QUOTA_MONTHLY_LIMIT,
      100000,
    ),
  };
  const billingWebhookUrl = normalize(
    process.env.OMNIAGENT_BILLING_WEBHOOK_URL,
  );
  const billingWebhookSecret = normalize(
    process.env.OMNIAGENT_BILLING_WEBHOOK_SECRET,
  );
  const billingWebhookMaxAttempts = parsePositiveInt(
    process.env.OMNIAGENT_BILLING_WEBHOOK_MAX_ATTEMPTS,
    5,
  );
  const billingWebhookRetryBaseMs = parsePositiveInt(
    process.env.OMNIAGENT_BILLING_WEBHOOK_RETRY_BASE_MS,
    1000,
  );
  const billingWebhookTimeoutMs = parsePositiveInt(
    process.env.OMNIAGENT_BILLING_WEBHOOK_TIMEOUT_MS,
    5000,
  );
  const billingCreditsPerExecution = parseNonNegativeInt(
    process.env.OMNIAGENT_BILLING_CREDITS_PER_EXECUTION,
    1,
  );
  const billingChargeOnFailure = parseBoolean(
    process.env.OMNIAGENT_BILLING_CHARGE_ON_FAILURE,
    false,
  );
  const securityJsonBodyMaxBytes = parsePositiveInt(
    process.env.OMNIAGENT_SECURITY_JSON_MAX_BYTES,
    1024 * 1024,
  );
  const securityMultipartBodyMaxBytes = parsePositiveInt(
    process.env.OMNIAGENT_SECURITY_MULTIPART_MAX_BYTES,
    100 * 1024 * 1024,
  );
  const securityWriteRateLimitPerMinute = parsePositiveInt(
    process.env.OMNIAGENT_SECURITY_WRITE_RATE_PER_MINUTE,
    120,
  );
  const auditLogMaxEntries = parsePositiveInt(
    process.env.OMNIAGENT_AUDIT_LOG_MAX_ENTRIES,
    2000,
  );
  const observabilityRequestSampleLimit = parsePositiveInt(
    process.env.OMNIAGENT_OBSERVABILITY_REQUEST_SAMPLE_LIMIT,
    2000,
  );
  const observabilityWaitSampleLimit = parsePositiveInt(
    process.env.OMNIAGENT_OBSERVABILITY_WAIT_SAMPLE_LIMIT,
    1000,
  );
  const xhsBridgeUrl = stripTrailingSlash(
    normalize(process.env.OMNIAGENT_XHS_BRIDGE_URL) ??
      "http://127.0.0.1:5556",
  );
  const xhsCookie =
    normalize(process.env.OMNIAGENT_XHS_COOKIE) ??
    normalize(process.env.XHS_COOKIE);
  const hasS3Config = Boolean(
    s3Endpoint && s3Bucket && s3AccessKey && s3SecretKey,
  );

  return {
    auditLogMaxEntries,
    apiKeys: dedupeApiKeys(
      singleKey ? [singleKey, ...jsonApiKeys] : [...jsonApiKeys],
    ),
    artifactStore: artifactStoreHint === "none" || !hasS3Config ? "none" : "s3",
    authMode,
    billingChargeOnFailure,
    billingCreditsPerExecution,
    billingWebhookMaxAttempts,
    billingWebhookRetryBaseMs,
    billingWebhookSecret,
    billingWebhookTimeoutMs,
    billingWebhookUrl,
    databaseUrl,
    executorBaseUrl: normalize(process.env.OMNIAGENT_EXECUTOR_BASE_URL),
    jobStore: jobStoreHint === "local" || !redisUrl ? "local" : "redis",
    openaiApiKey: normalize(process.env.OPENAI_API_KEY),
    openaiBaseUrl: normalize(process.env.OPENAI_BASE_URL),
    openaiModel: chatModel,
    openaiProtocol: parseProtocol(process.env.OPENAI_PROTOCOL, "responses"),
    observabilityRequestSampleLimit,
    observabilityWaitSampleLimit,
    redisUrl,
    relayBaseUrl: relayBaseUrl ? stripTrailingSlash(relayBaseUrl) : undefined,
    relayApiKey,
    relayModel: chatModel,
    relayProtocol: parseProtocol(process.env.OMNIAGENT_RELAY_PROTOCOL, "chat"),
    reservedPorts: [3000, 4000, 3004, 3005],
    runStore: runStoreHint === "local" || !databaseUrl ? "local" : "postgres",
    s3AccessKey,
    s3Bucket,
    s3Endpoint: s3Endpoint ? stripTrailingSlash(s3Endpoint) : undefined,
    s3InternalEndpoint: s3InternalEndpoint
      ? stripTrailingSlash(s3InternalEndpoint)
      : undefined,
    s3Region,
    s3SecretKey,
    s3SignedUrlTtlSec,
    securityJsonBodyMaxBytes,
    securityMultipartBodyMaxBytes,
    securityWriteRateLimitPerMinute,
    serviceMode,
    trustedLocalTenantId,
    usageStore:
      usageStoreHint === "local" || !databaseUrl ? "local" : "postgres",
    xhsBridgeUrl,
    xhsCookie,
    quotaDefaults,
  };
};
