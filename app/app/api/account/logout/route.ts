import { accountStore } from "@/lib/server/account-store";
import { buildClearSessionCookie, getWebSessionToken } from "@/lib/server/web-auth";

export async function POST(req: Request) {
  accountStore.logoutByToken(getWebSessionToken(req));
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": buildClearSessionCookie(),
      },
    },
  );
}
