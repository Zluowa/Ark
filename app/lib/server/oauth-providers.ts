// @input: provider id + environment variables
// @output: OAuth provider config and URL helpers
// @position: server OAuth configuration layer

import type { ApiConnectionProvider } from "@/lib/shared/connection-providers";

const normalize = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const parseScopes = (raw: string | undefined, fallback: string[]): string[] => {
  const value = normalize(raw);
  if (!value) return fallback;
  return value
    .split(/[,\n\r\t ]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
};

const parseParams = (raw: string | undefined): Record<string, string> => {
  const value = normalize(raw);
  if (!value) return {};
  const result: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [k, ...rest] = pair.split("=");
    const key = k?.trim();
    const joined = rest.join("=").trim();
    if (key && joined) result[key] = joined;
  }
  return result;
};

const boolFromEnv = (raw: string | undefined, fallback: boolean): boolean => {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
};

type TokenAuthMethod = "client_secret_post" | "client_secret_basic";
type TokenEncoding = "form" | "json";

export type OAuthProvider = Exclude<ApiConnectionProvider, "xhs" | "netease">;

export type OAuthProviderConfig = {
  provider: OAuthProvider;
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes: string[];
  scopeSeparator: " " | ",";
  authorizeParams: Record<string, string>;
  tokenParams: Record<string, string>;
  tokenAuthMethod: TokenAuthMethod;
  tokenEncoding: TokenEncoding;
  usePkce: boolean;
};

type ProviderDefaults = {
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes: string[];
  scopeSeparator?: " " | ",";
  authorizeParams?: Record<string, string>;
  tokenParams?: Record<string, string>;
  tokenAuthMethod?: TokenAuthMethod;
  tokenEncoding?: TokenEncoding;
  usePkce?: boolean;
};

const OAUTH_PROVIDERS = [
  "gmail",
  "google-drive",
  "slack",
  "notion",
  "feishu",
  "dingtalk",
  "wechat-work",
  "alipay",
] as const satisfies readonly OAuthProvider[];

const ENV_ALIASES: Partial<
  Record<OAuthProvider, { clientId?: string[]; clientSecret?: string[] }>
> = {
  gmail: {
    clientId: ["GOOGLE_CLIENT_ID", "GMAIL_CLIENT_ID"],
    clientSecret: ["GOOGLE_CLIENT_SECRET", "GMAIL_CLIENT_SECRET"],
  },
  "google-drive": {
    clientId: ["GOOGLE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_ID"],
    clientSecret: ["GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_CLIENT_SECRET"],
  },
  feishu: {
    clientId: ["FEISHU_APP_ID"],
    clientSecret: ["FEISHU_APP_SECRET"],
  },
};

const PROVIDER_DEFAULTS: Record<OAuthProvider, ProviderDefaults> = {
  gmail: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
  },
  "google-drive": {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  slack: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read", "files:write"],
    scopeSeparator: ",",
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    authorizeParams: { owner: "user" },
    tokenAuthMethod: "client_secret_basic",
  },
  feishu: {
    authorizeUrl: "https://open.feishu.cn/open-apis/authen/v1/authorize",
    tokenUrl: "https://open.feishu.cn/open-apis/authen/v1/oidc/access_token",
    scopes: [],
    tokenEncoding: "json",
  },
  dingtalk: {
    authorizeUrl: "https://login.dingtalk.com/oauth2/auth",
    tokenUrl: "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
    scopes: ["openid"],
    tokenEncoding: "json",
  },
  "wechat-work": { scopes: [] },
  alipay: { scopes: [] },
};

const toEnvKey = (provider: OAuthProvider): string =>
  provider.replace(/-/g, "_").toUpperCase();

export const isOAuthProvider = (provider: string): provider is OAuthProvider =>
  (OAUTH_PROVIDERS as readonly string[]).includes(provider);

const firstDefinedEnv = (keys: string[] | undefined): string | undefined => {
  if (!keys?.length) return undefined;
  for (const key of keys) {
    const value = normalize(process.env[key]);
    if (value) return value;
  }
  return undefined;
};

export const getOAuthProviderConfig = (
  provider: OAuthProvider,
): OAuthProviderConfig => {
  const defaults = PROVIDER_DEFAULTS[provider];
  const prefix = `OMNIAGENT_OAUTH_${toEnvKey(provider)}`;
  const aliases = ENV_ALIASES[provider];

  const clientId =
    normalize(process.env[`${prefix}_CLIENT_ID`]) ??
    firstDefinedEnv(aliases?.clientId);
  const clientSecret =
    normalize(process.env[`${prefix}_CLIENT_SECRET`]) ??
    firstDefinedEnv(aliases?.clientSecret);
  const authorizeUrl =
    normalize(process.env[`${prefix}_AUTHORIZE_URL`]) ?? defaults.authorizeUrl;
  const tokenUrl =
    normalize(process.env[`${prefix}_TOKEN_URL`]) ?? defaults.tokenUrl;
  const scopes = parseScopes(process.env[`${prefix}_SCOPES`], defaults.scopes);
  const scopeSeparatorRaw =
    normalize(process.env[`${prefix}_SCOPE_SEPARATOR`]) ??
    defaults.scopeSeparator ??
    " ";
  const scopeSeparator = scopeSeparatorRaw === "," ? "," : " ";
  const tokenAuthMethodRaw = normalize(
    process.env[`${prefix}_TOKEN_AUTH_METHOD`],
  );
  const tokenAuthMethod: TokenAuthMethod =
    tokenAuthMethodRaw === "client_secret_basic"
      ? "client_secret_basic"
      : (defaults.tokenAuthMethod ?? "client_secret_post");
  const tokenEncodingRaw = normalize(process.env[`${prefix}_TOKEN_ENCODING`]);
  const tokenEncoding: TokenEncoding =
    tokenEncodingRaw === "json" ? "json" : (defaults.tokenEncoding ?? "form");
  const authorizeParams = {
    ...(defaults.authorizeParams ?? {}),
    ...parseParams(process.env[`${prefix}_AUTHORIZE_PARAMS`]),
  };
  const tokenParams = {
    ...(defaults.tokenParams ?? {}),
    ...parseParams(process.env[`${prefix}_TOKEN_PARAMS`]),
  };
  const usePkce = boolFromEnv(
    process.env[`${prefix}_USE_PKCE`],
    defaults.usePkce ?? false,
  );
  const enabled = Boolean(clientId && clientSecret && authorizeUrl && tokenUrl);

  return {
    provider,
    enabled,
    clientId,
    clientSecret,
    authorizeUrl,
    tokenUrl,
    scopes,
    scopeSeparator,
    authorizeParams,
    tokenParams,
    tokenAuthMethod,
    tokenEncoding,
    usePkce,
  };
};

export const isOAuthProviderConfigured = (provider: OAuthProvider): boolean =>
  getOAuthProviderConfig(provider).enabled;

export const getMissingOAuthConfigFields = (
  config: OAuthProviderConfig,
): string[] => {
  const missing: string[] = [];
  if (!config.clientId) missing.push("client_id");
  if (!config.clientSecret) missing.push("client_secret");
  if (!config.authorizeUrl) missing.push("authorize_url");
  if (!config.tokenUrl) missing.push("token_url");
  return missing;
};

export const resolveOAuthBaseUrl = (req: Request): string => {
  const configured = normalize(process.env.OMNIAGENT_OAUTH_BASE_URL);
  if (configured) return stripTrailingSlash(configured);
  return stripTrailingSlash(new URL(req.url).origin);
};

export const resolveOAuthCallbackUrl = (req: Request): string =>
  `${resolveOAuthBaseUrl(req)}/api/v1/connections/oauth/callback`;

export const resolveOAuthCallbackUrlForProvider = (
  req: Request,
  provider: OAuthProvider,
): string => {
  const envKey = `OMNIAGENT_OAUTH_${toEnvKey(provider)}_REDIRECT_URI`;
  const override = normalize(process.env[envKey]);
  if (override) return override;
  return resolveOAuthCallbackUrl(req);
};

export const resolveConnectionsPageUrl = (req: Request): string =>
  `${resolveOAuthBaseUrl(req)}/dashboard/connections`;
