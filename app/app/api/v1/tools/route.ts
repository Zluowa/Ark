import { listTools } from "@/lib/server/tool-catalog";
import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";

const parseLimit = (url: URL): number | undefined => {
  const raw = url.searchParams.get("limit");
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
};

export async function GET(req: Request) {
  const access = authorizeRequest(req, "execute:read");
  if (!access.ok) {
    return toResponse(access);
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const limit = parseLimit(url);
  const tools = listTools({ query: q, limit });

  return Response.json({
    ok: true,
    count: tools.length,
    tools,
  });
}
