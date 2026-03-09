// @input: GET callback from OAuth provider (?code=...&state=... or ?error=...)
// @output: redirects browser back to /dashboard/connections with oauth_status query
// @position: API route — completes OAuth flow and persists credential

import { credentialStore } from "@/lib/server/credential-store";
import { consumeOAuthState, exchangeOAuthCode } from "@/lib/server/oauth-flow";
import {
  getOAuthProviderConfig,
  resolveConnectionsPageUrl,
} from "@/lib/server/oauth-providers";

const buildRedirect = (
  req: Request,
  opts: {
    returnUrl?: string;
    provider?: string;
    status: "success" | "error";
    error?: string;
  },
): Response => {
  const fallback = resolveConnectionsPageUrl(req);
  const url = new URL(opts.returnUrl || fallback);
  url.searchParams.set("oauth_status", opts.status);
  if (opts.provider) url.searchParams.set("oauth_provider", opts.provider);
  if (opts.error) url.searchParams.set("oauth_error", opts.error.slice(0, 180));
  return Response.redirect(url, 302);
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const providerError = url.searchParams.get("error")?.trim();
  const providerErrorDescription = url.searchParams
    .get("error_description")
    ?.trim();

  if (!state) {
    return buildRedirect(req, { status: "error", error: "missing_state" });
  }

  const stateRecord = consumeOAuthState(state);
  if (!stateRecord) {
    return buildRedirect(req, {
      status: "error",
      error: "invalid_or_expired_state",
    });
  }

  if (providerError) {
    return buildRedirect(req, {
      returnUrl: stateRecord.returnUrl,
      provider: stateRecord.provider,
      status: "error",
      error: providerErrorDescription || providerError,
    });
  }

  if (!code) {
    return buildRedirect(req, {
      returnUrl: stateRecord.returnUrl,
      provider: stateRecord.provider,
      status: "error",
      error: "missing_code",
    });
  }

  try {
    const config = getOAuthProviderConfig(stateRecord.provider);
    if (!config.enabled) {
      return buildRedirect(req, {
        returnUrl: stateRecord.returnUrl,
        provider: stateRecord.provider,
        status: "error",
        error: "oauth_provider_not_configured",
      });
    }

    const tokenSet = await exchangeOAuthCode({
      config,
      code,
      redirectUri: stateRecord.redirectUri,
      codeVerifier: stateRecord.codeVerifier,
    });

    const obtainedAt = Date.now();
    const credentialPayload = {
      kind: "oauth2",
      provider: stateRecord.provider,
      access_token: tokenSet.accessToken,
      refresh_token: tokenSet.refreshToken,
      token_type: tokenSet.tokenType,
      scope: tokenSet.scope,
      expires_at: tokenSet.expiresIn
        ? obtainedAt + tokenSet.expiresIn * 1000
        : undefined,
      obtained_at: obtainedAt,
      raw: tokenSet.raw,
    };
    await credentialStore.upsert(
      stateRecord.tenantId,
      stateRecord.provider,
      JSON.stringify(credentialPayload),
    );

    return buildRedirect(req, {
      returnUrl: stateRecord.returnUrl,
      provider: stateRecord.provider,
      status: "success",
    });
  } catch (error) {
    return buildRedirect(req, {
      returnUrl: stateRecord.returnUrl,
      provider: stateRecord.provider,
      status: "error",
      error: error instanceof Error ? error.message : "oauth_exchange_failed",
    });
  }
}
