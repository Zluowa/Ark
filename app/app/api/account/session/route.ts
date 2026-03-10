import { publicSessionPayload, resolveWebSession } from "@/lib/server/web-auth";

export async function GET(req: Request) {
  return Response.json({
    ok: true,
    ...publicSessionPayload(resolveWebSession(req)),
  });
}
