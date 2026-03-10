import { accountStore } from "@/lib/server/account-store";
import { getWebSessionToken, publicSessionPayload, resolveWebSession } from "@/lib/server/web-auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const session = resolveWebSession(req);
  if (!session) {
    return Response.json(
      { ok: false, error: { code: "auth_required", message: "Login required." } },
      { status: 401 },
    );
  }

  try {
    const next = accountStore.switchWorkspace(
      getWebSessionToken(req),
      (await params).workspaceId,
    );
    return Response.json({
      ok: true,
      ...publicSessionPayload(next),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "workspace_switch_failed",
          message: error instanceof Error ? error.message : "Failed to switch workspace.",
        },
      },
      { status: 400 },
    );
  }
}
