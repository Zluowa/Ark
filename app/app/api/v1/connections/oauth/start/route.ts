// @input: POST { provider, scopes?, redirectUri?, returnUrl? }
// @output: OAuth authorize URL for browser redirect
// @position: API route — starts generic OAuth connection flow

import { authorizeRequest } from "@/lib/server/access-control";
import {
  getMissingOAuthConfigFields,
  getOAuthProviderConfig,
  isOAuthProvider,
  resolveConnectionsPageUrl,
  resolveOAuthBaseUrl,
  resolveOAuthCallbackUrlForProvider,
} from "@/lib/server/oauth-providers";
import {
  buildOAuthAuthorizeUrl,
  createOAuthStateRecord,
  oauthStateTtlSeconds,
} from "@/lib/server/oauth-flow";
import { normalizeConnectionProvider } from "@/lib/shared/connection-providers";
import { toResponse } from "@/lib/shared/result";

type OAuthStartPayload = {
  provider?: string;
  scopes?: unknown;
  redirectUri?: string;
  redirect_uri?: string;
  returnUrl?: string;
  return_url?: string;
};

const normalizeUrlWithBase = (
  input: string | undefined,
  fallback: string,
  baseOrigin: string,
): string => {
  const value = input?.trim();
  if (!value) return fallback;
  try {
    if (value.startsWith("/")) {
      return new URL(value, baseOrigin).toString();
    }
    const parsed = new URL(value);
    if (parsed.origin !== baseOrigin) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
};

const normalizeScopes = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const scopes = raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  return scopes.length > 0 ? scopes : undefined;
};

export async function POST(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  let payload: OAuthStartPayload = {};
  try {
    payload = (await req.json()) as OAuthStartPayload;
  } catch {
    payload = {};
  }

  const providerInput = payload.provider?.trim().toLowerCase();
  if (!providerInput) {
    return Response.json(
      {
        ok: false,
        error: { code: "provider_required", message: "provider is required" },
      },
      { status: 400 },
    );
  }

  const apiProvider = normalizeConnectionProvider(providerInput);
  if (!apiProvider) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "provider_invalid",
          message: `unsupported provider: ${providerInput}`,
        },
      },
      { status: 400 },
    );
  }
  if (apiProvider === "xhs" || apiProvider === "netease") {
    return Response.json(
      {
        ok: false,
        error: {
          code: "provider_unsupported_flow",
          message:
            `${apiProvider} uses the dedicated QR auth flow, not OAuth callback flow`,
        },
      },
      { status: 400 },
    );
  }
  if (!isOAuthProvider(apiProvider)) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "provider_invalid",
          message: `unsupported oauth provider: ${providerInput}`,
        },
      },
      { status: 400 },
    );
  }

  const config = getOAuthProviderConfig(apiProvider);
  if (!config.enabled) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "oauth_not_configured",
          message: `OAuth for ${apiProvider} is not configured`,
          details: { missing: getMissingOAuthConfigFields(config) },
        },
      },
      { status: 400 },
    );
  }

  const baseUrl = resolveOAuthBaseUrl(req);
  const defaultRedirectUri = resolveOAuthCallbackUrlForProvider(req, apiProvider);
  const defaultReturnUrl = resolveConnectionsPageUrl(req);
  const redirectUri = normalizeUrlWithBase(
    payload.redirectUri ?? payload.redirect_uri,
    defaultRedirectUri,
    baseUrl,
  );
  const returnUrl = normalizeUrlWithBase(
    payload.returnUrl ?? payload.return_url,
    defaultReturnUrl,
    baseUrl,
  );

  const stateRecord = createOAuthStateRecord({
    provider: apiProvider,
    tenantId: access.identity.tenantId,
    redirectUri,
    returnUrl,
    usePkce: config.usePkce,
  });
  const authorizeUrl = buildOAuthAuthorizeUrl({
    config,
    stateRecord,
    scopes: normalizeScopes(payload.scopes),
  });

  return Response.json({
    ok: true,
    provider: apiProvider,
    authorize_url: authorizeUrl,
    expires_in: oauthStateTtlSeconds,
    state: stateRecord.state,
  });
}
