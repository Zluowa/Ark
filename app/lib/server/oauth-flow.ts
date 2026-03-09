// @input: OAuth provider config, tenant id, auth code/state
// @output: persisted OAuth state, authorize URL, and exchanged token set
// @position: server OAuth runtime helpers

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  OAuthProvider,
  OAuthProviderConfig,
} from "@/lib/server/oauth-providers";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const STATE_DIR = join(
  process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() ||
    join(process.cwd(), ".omniagent-state"),
  "oauth-states",
);

export type OAuthStateRecord = {
  state: string;
  provider: OAuthProvider;
  tenantId: string;
  redirectUri: string;
  returnUrl: string;
  createdAt: number;
  expiresAt: number;
  codeVerifier?: string;
};

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
  raw: Record<string, unknown>;
};

const sanitizeState = (state: string): string =>
  state.replace(/[^a-zA-Z0-9_-]/g, "");

const statePath = (state: string): string =>
  join(STATE_DIR, `${sanitizeState(state)}.json`);

const parseObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readNumericField = (
  payload: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const writeState = (record: OAuthStateRecord): void => {
  mkdirSync(STATE_DIR, { recursive: true });
  const path = statePath(record.state);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(record), "utf8");
  renameSync(tmp, path);
};

const readState = (state: string): OAuthStateRecord | null => {
  try {
    return JSON.parse(
      readFileSync(statePath(state), "utf8"),
    ) as OAuthStateRecord;
  } catch {
    return null;
  }
};

const deleteState = (state: string): void => {
  try {
    unlinkSync(statePath(state));
  } catch {
    // ignore cleanup failures
  }
};

const cleanupExpiredStates = (): void => {
  if (!existsSync(STATE_DIR)) return;
  const now = Date.now();
  for (const file of readdirSync(STATE_DIR)) {
    if (!file.endsWith(".json")) continue;
    const state = file.slice(0, -5);
    const record = readState(state);
    if (!record || record.expiresAt <= now) {
      deleteState(state);
    }
  }
};

export const createOAuthStateRecord = (args: {
  provider: OAuthProvider;
  tenantId: string;
  redirectUri: string;
  returnUrl: string;
  usePkce: boolean;
}): OAuthStateRecord => {
  cleanupExpiredStates();

  const state = randomBytes(24).toString("base64url");
  const now = Date.now();
  const codeVerifier = args.usePkce
    ? randomBytes(32).toString("base64url")
    : undefined;

  const record: OAuthStateRecord = {
    state,
    provider: args.provider,
    tenantId: args.tenantId,
    redirectUri: args.redirectUri,
    returnUrl: args.returnUrl,
    createdAt: now,
    expiresAt: now + OAUTH_STATE_TTL_MS,
    ...(codeVerifier ? { codeVerifier } : {}),
  };
  writeState(record);
  return record;
};

export const consumeOAuthState = (state: string): OAuthStateRecord | null => {
  const safe = sanitizeState(state);
  if (!safe || safe !== state) return null;
  const record = readState(safe);
  deleteState(safe);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) return null;
  return record;
};

const createCodeChallenge = (codeVerifier: string): string =>
  createHash("sha256").update(codeVerifier).digest("base64url");

export const buildOAuthAuthorizeUrl = (args: {
  config: OAuthProviderConfig;
  stateRecord: OAuthStateRecord;
  scopes?: string[];
}): string => {
  const { config, stateRecord } = args;
  if (!config.authorizeUrl || !config.clientId) {
    throw new Error(`OAuth provider ${config.provider} is not configured`);
  }

  const scopes = args.scopes?.length ? args.scopes : config.scopes;
  const url = new URL(config.authorizeUrl);
  const params = url.searchParams;

  params.set("response_type", "code");
  if (config.provider === "feishu") {
    // Feishu auth endpoint uses app_id in official docs.
    params.set("app_id", config.clientId);
  } else {
    params.set("client_id", config.clientId);
  }
  params.set("redirect_uri", stateRecord.redirectUri);
  params.set("state", stateRecord.state);
  if (scopes.length > 0) {
    params.set("scope", scopes.join(config.scopeSeparator));
  }
  for (const [key, value] of Object.entries(config.authorizeParams)) {
    if (value) params.set(key, value);
  }
  if (config.usePkce && stateRecord.codeVerifier) {
    params.set("code_challenge", createCodeChallenge(stateRecord.codeVerifier));
    params.set("code_challenge_method", "S256");
  }

  return url.toString();
};

const parseTokenPayload = (
  provider: OAuthProvider,
  payload: Record<string, unknown>,
): OAuthTokenSet => {
  if (provider === "slack" && payload.ok === false) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : "Slack token exchange failed";
    throw new Error(message);
  }

  if (provider === "feishu") {
    const code = payload.code;
    if (typeof code === "number" && code !== 0) {
      const message =
        typeof payload.msg === "string"
          ? payload.msg
          : `Feishu token exchange failed: code=${String(code)}`;
      throw new Error(message);
    }
    const data = parseObject(payload.data);
    const accessToken =
      typeof data.access_token === "string" ? data.access_token : undefined;
    if (!accessToken) {
      throw new Error("Feishu token response missing access_token");
    }
    return {
      accessToken,
      refreshToken:
        typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      expiresIn: readNumericField(data, ["expires_in"]),
      tokenType:
        typeof data.token_type === "string" ? data.token_type : undefined,
      scope: typeof data.scope === "string" ? data.scope : undefined,
      raw: payload,
    };
  }

  if (provider === "dingtalk") {
    const accessToken =
      typeof payload.accessToken === "string" ? payload.accessToken : undefined;
    if (!accessToken) {
      throw new Error("DingTalk token response missing accessToken");
    }
    return {
      accessToken,
      refreshToken:
        typeof payload.refreshToken === "string"
          ? payload.refreshToken
          : undefined,
      expiresIn: readNumericField(payload, ["expireIn", "expiresIn"]),
      tokenType:
        typeof payload.tokenType === "string" ? payload.tokenType : undefined,
      scope: typeof payload.scope === "string" ? payload.scope : undefined,
      raw: payload,
    };
  }

  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token : undefined;
  if (!accessToken) {
    throw new Error(
      `OAuth token response missing access_token for ${provider}`,
    );
  }
  return {
    accessToken,
    refreshToken:
      typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : undefined,
    expiresIn: readNumericField(payload, ["expires_in", "expiresIn"]),
    tokenType:
      typeof payload.token_type === "string" ? payload.token_type : undefined,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
    raw: payload,
  };
};

export const exchangeOAuthCode = async (args: {
  config: OAuthProviderConfig;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<OAuthTokenSet> => {
  const { config, code, redirectUri, codeVerifier } = args;
  if (!config.tokenUrl || !config.clientId || !config.clientSecret) {
    throw new Error(`OAuth provider ${config.provider} is not configured`);
  }

  const headers = new Headers({ Accept: "application/json" });
  let body = "";

  if (config.provider === "dingtalk") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      grantType: "authorization_code",
      ...config.tokenParams,
    });
  } else if (config.provider === "feishu") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify({
      grant_type: "authorization_code",
      code,
      app_id: config.clientId,
      app_secret: config.clientSecret,
      redirect_uri: redirectUri,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      ...config.tokenParams,
    });
  } else if (config.tokenEncoding === "json") {
    headers.set("Content-Type", "application/json");
    const payload: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      ...config.tokenParams,
    };
    if (config.tokenAuthMethod === "client_secret_post") {
      payload.client_id = config.clientId;
      payload.client_secret = config.clientSecret;
    } else {
      const basic = Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64");
      headers.set("Authorization", `Basic ${basic}`);
    }
    if (codeVerifier) payload.code_verifier = codeVerifier;
    body = JSON.stringify(payload);
  } else {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", code);
    params.set("redirect_uri", redirectUri);
    for (const [key, value] of Object.entries(config.tokenParams)) {
      params.set(key, value);
    }
    if (config.tokenAuthMethod === "client_secret_post") {
      params.set("client_id", config.clientId);
      params.set("client_secret", config.clientSecret);
    } else {
      const basic = Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64");
      headers.set("Authorization", `Basic ${basic}`);
    }
    if (codeVerifier) params.set("code_verifier", codeVerifier);
    body = params.toString();
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body,
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = parseObject(await response.json());
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const reason =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : `OAuth token exchange failed (${response.status})`;
    throw new Error(reason);
  }

  return parseTokenPayload(config.provider, payload);
};

export const oauthStateTtlSeconds = Math.floor(OAUTH_STATE_TTL_MS / 1000);
