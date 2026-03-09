// @input: GET with sessionId param to poll auth status
// @output: { status: "waiting" | "success" | "failed" | "expired", mode: "headed" | "headless" }
// @position: API route — poll XHS auth session status

import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { getAuthStatus } from "@/lib/server/xhs-auth";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(req: Request, context: RouteContext) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  const { sessionId } = await context.params;
  const result = getAuthStatus(sessionId);
  if (!result) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  return Response.json(result);
}
