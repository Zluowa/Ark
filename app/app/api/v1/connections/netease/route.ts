// @input: GET for status, DELETE for disconnect
// @output: NetEase connection status or disconnect acknowledgement
// @position: API route - tenant-scoped NetEase credential management

import { authorizeRequest } from "@/lib/server/access-control";
import { credentialStore } from "@/lib/server/credential-store";
import { getNeteaseConnection } from "@/lib/server/netease-auth";
import { toResponse } from "@/lib/shared/result";

export async function GET(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  const result = await getNeteaseConnection(access.identity.tenantId);
  return Response.json(result);
}

export async function DELETE(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  await credentialStore.remove(access.identity.tenantId, "netease");
  return Response.json({ ok: true });
}
