// @input: POST from trusted-local proof/dev environments
// @output: locally seeded NetEase connection using env cookie or anonymous guest
// @position: API route - native proof helper for unattended connected-state coverage

import { authorizeRequest } from "@/lib/server/access-control";
import { seedNeteaseConnection } from "@/lib/server/netease-auth";
import { toResponse } from "@/lib/shared/result";

export async function POST(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);
  if (!access.identity.trustedLocal) {
    return Response.json(
      { error: "NetEase seed is only available in trusted local mode." },
      { status: 403 },
    );
  }

  const result = await seedNeteaseConnection(access.identity.tenantId);
  return Response.json(result);
}
