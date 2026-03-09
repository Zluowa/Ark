// @input: POST body { query: string }
// @output: Top-5 RouteMatch array from zero-token intent router
// @position: Testing endpoint for the v5 intent router

import { initEngine } from "@/lib/engine/init";
import { routeIntent } from "@/lib/engine/router";
import { validateApiKey } from "@/lib/engine/auth";

initEngine();

export async function POST(req: Request) {
  const auth = validateApiKey(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { code: "bad_request", message: "Invalid JSON body" } },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).query !== "string"
  ) {
    return Response.json(
      { error: { code: "bad_request", message: "body.query must be a string" } },
      { status: 400 },
    );
  }

  const query = ((body as Record<string, unknown>).query as string).trim();
  if (!query) {
    return Response.json(
      { error: { code: "bad_request", message: "query must not be empty" } },
      { status: 400 },
    );
  }

  const matches = routeIntent(query);
  return Response.json({ ok: true, query, matches });
}
