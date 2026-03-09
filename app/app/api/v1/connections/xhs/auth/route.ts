// @input: POST request to start XHS auth (headed or headless)
// @output: { sessionId, mode: "headed" } or { sessionId, mode: "headless", qrImageBase64 }
// @position: API route — initiates Playwright login flow (auto-detects mode)

import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { startXhsAuth } from "@/lib/server/xhs-auth";

export async function POST(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  try {
    const result = await startXhsAuth(access.identity.tenantId);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "启动登录失败" },
      { status: 500 },
    );
  }
}
