// @input: GET with sessionId param
// @output: { sessionId, status, qrImageBase64, qrUrl, account? }
// @position: API route - polls NetEase QR auth session

import { authorizeRequest } from "@/lib/server/access-control";
import { getNeteaseAuthStatus } from "@/lib/server/netease-auth";
import { toResponse } from "@/lib/shared/result";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(req: Request, context: RouteContext) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  const { sessionId } = await context.params;
  const result = await getNeteaseAuthStatus(sessionId);
  if (!result) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  return Response.json(result);
}
