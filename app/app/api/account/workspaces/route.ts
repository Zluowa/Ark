import { z } from "zod";
import { accountStore } from "@/lib/server/account-store";
import { publicSessionPayload, resolveWebSession } from "@/lib/server/web-auth";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function GET(req: Request) {
  const session = resolveWebSession(req);
  if (!session) {
    return Response.json(
      { ok: false, error: { code: "auth_required", message: "Login required." } },
      { status: 401 },
    );
  }
  return Response.json({
    ok: true,
    ...publicSessionPayload(session),
  });
}

export async function POST(req: Request) {
  const session = resolveWebSession(req);
  if (!session) {
    return Response.json(
      { ok: false, error: { code: "auth_required", message: "Login required." } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: { code: "invalid_body", message: parsed.error.issues[0]?.message ?? "Invalid request." } },
      { status: 400 },
    );
  }

  try {
    const workspace = accountStore.createWorkspace(session.user.id, parsed.data.name);
    const refreshed = resolveWebSession(req);
    return Response.json({
      ok: true,
      workspace,
      ...publicSessionPayload(refreshed),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "workspace_create_failed",
          message: error instanceof Error ? error.message : "Failed to create workspace.",
        },
      },
      { status: 400 },
    );
  }
}
