import { z } from "zod";
import { accountStore } from "@/lib/server/account-store";
import { buildSessionCookie, publicSessionPayload } from "@/lib/server/web-auth";

const schema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  workspaceName: z.string().trim().min(1).max(80).optional(),
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
    const created = accountStore.register(parsed.data);
    return Response.json(
      {
        ok: true,
        ...publicSessionPayload(created.session),
      },
      {
        status: 201,
        headers: {
          "Set-Cookie": buildSessionCookie(created.sessionToken),
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "register_failed",
          message: error instanceof Error ? error.message : "Failed to register account.",
        },
      },
      { status: 400 },
    );
  }
}
