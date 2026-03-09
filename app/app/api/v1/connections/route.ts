// @input: GET request with auth header
// @output: list of connection statuses per provider
// @position: API route — connection status overview

import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { credentialStore } from "@/lib/server/credential-store";
import {
  isOAuthProvider,
  isOAuthProviderConfigured,
} from "@/lib/server/oauth-providers";
import { API_CONNECTION_PROVIDERS } from "@/lib/shared/connection-providers";

export async function GET(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  const creds = await credentialStore.list(access.identity.tenantId);
  const providers = API_CONNECTION_PROVIDERS;

  const connections = providers.map((provider) => {
    const cred = creds.find((c) => c.provider === provider);
    const oauthConfigured =
      provider === "xhs" || provider === "netease"
        ? true
        : isOAuthProvider(provider)
          ? isOAuthProviderConfigured(provider)
          : false;
    return {
      provider,
      status: cred?.status ?? "none",
      updatedAt: cred?.updatedAt,
      oauthConfigured,
    };
  });

  return Response.json({ connections });
}
