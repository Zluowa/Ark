import { getToolById } from "@/lib/server/tool-catalog";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";

type ParamsContext = {
  params: Promise<unknown>;
};

export async function GET(req: Request, context: ParamsContext) {
  const access = authorizeRequest(req, "execute:read");
  if (!access.ok) {
    return toResponse(access);
  }

  const { toolId } = (await context.params) as { toolId?: string };
  if (!toolId) {
    return Response.json(
      {
        error: {
          code: "bad_request",
          message: "Missing tool id",
        },
      },
      { status: 400 },
    );
  }

  const decodedToolId = decodeURIComponent(toolId);
  const tool = getToolById(decodedToolId);
  if (!tool) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: `Tool not found: ${decodedToolId}`,
        },
      },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, tool });
}
