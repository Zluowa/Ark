// @input: DELETE with provider route param
// @output: { ok: true } after removing tenant-scoped credential
// @position: API route — generic connection disconnect endpoint

import { authorizeRequest } from "@/lib/server/access-control";
import { credentialStore } from "@/lib/server/credential-store";
import { normalizeConnectionProvider } from "@/lib/shared/connection-providers";
import { toResponse } from "@/lib/shared/result";

type RouteContext = { params: Promise<{ provider: string }> };

export async function DELETE(req: Request, context: RouteContext) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  const { provider: rawProvider } = await context.params;
  const provider = normalizeConnectionProvider(
    rawProvider.trim().toLowerCase(),
  );
  if (!provider) {
    return Response.json(
      {
        ok: false,
        error: { code: "provider_invalid", message: "Invalid provider" },
      },
      { status: 404 },
    );
  }

  await credentialStore.remove(access.identity.tenantId, provider);
  return Response.json({ ok: true });
}
