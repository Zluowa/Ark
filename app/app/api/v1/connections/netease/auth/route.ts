// @input: POST request to start NetEase QR auth
// @output: { sessionId, status, qrImageBase64, qrUrl }
// @position: API route - starts tenant-scoped NetEase QR session

import { authorizeRequest } from "@/lib/server/access-control";
import { startNeteaseAuth } from "@/lib/server/netease-auth";
import { toResponse } from "@/lib/shared/result";

export async function POST(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  try {
    const result = await startNeteaseAuth(access.identity.tenantId);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start NetEase QR auth.",
      },
      { status: 500 },
    );
  }
}
