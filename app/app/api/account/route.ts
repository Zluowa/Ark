import { accountStore } from "@/lib/server/account-store";
import {
  buildClearSessionCookie,
  getWebSessionToken,
  resolveWebSession,
} from "@/lib/server/web-auth";

export async function DELETE(req: Request) {
  const session = resolveWebSession(req);
  if (!session) {
    return Response.json(
      { ok: false, error: { code: "auth_required", message: "Login required." } },
      { status: 401 },
    );
  }

  try {
    const deleted = accountStore.deleteAccountByToken(getWebSessionToken(req));
    return Response.json(
      {
        ok: true,
        deleted: {
          suspendedTenantIds: deleted.suspendedTenantIds,
          userId: deleted.userId,
          workspaceIds: deleted.workspaceIds,
        },
      },
      {
        headers: {
          "Set-Cookie": buildClearSessionCookie(),
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "account_delete_failed",
          message:
            error instanceof Error ? error.message : "Failed to delete account.",
        },
      },
      { status: 400 },
    );
  }
}
