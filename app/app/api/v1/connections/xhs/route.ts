// @input: DELETE request to disconnect XHS
// @output: { ok: true }
// @position: API route — remove XHS credential for tenant

import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { credentialStore } from "@/lib/server/credential-store";

export async function DELETE(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  await credentialStore.remove(access.identity.tenantId, "xhs");
  return Response.json({ ok: true });
}
