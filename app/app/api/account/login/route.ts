import { z } from "zod";
import { accountStore } from "@/lib/server/account-store";
import { buildSessionCookie, publicSessionPayload } from "@/lib/server/web-auth";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
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
    const loggedIn = accountStore.login(parsed.data);
    return Response.json(
      {
        ok: true,
        ...publicSessionPayload(loggedIn.session),
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": buildSessionCookie(loggedIn.sessionToken),
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "login_failed",
          message: error instanceof Error ? error.message : "Failed to log in.",
        },
      },
      { status: 401 },
    );
  }
}
