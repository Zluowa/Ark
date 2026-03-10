import { accountStore, type AccountSession } from "@/lib/server/account-store";

export const WEB_SESSION_COOKIE = "ark_session";
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

const parseCookies = (raw: string | null): Map<string, string> => {
  const cookies = new Map<string, string>();
  if (!raw) {
    return cookies;
  }
  for (const chunk of raw.split(";")) {
    const [name, ...rest] = chunk.trim().split("=");
    if (!name || rest.length === 0) {
      continue;
    }
    cookies.set(name, decodeURIComponent(rest.join("=")));
  }
  return cookies;
};

export const getWebSessionToken = (req: Request): string | undefined => {
  const cookies = parseCookies(req.headers.get("cookie"));
  return cookies.get(WEB_SESSION_COOKIE)?.trim() || undefined;
};

export const resolveWebSession = (req: Request): AccountSession | null =>
  accountStore.getSessionByToken(getWebSessionToken(req));

export const buildSessionCookie = (token: string): string =>
  [
    `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SEC}`,
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

export const buildClearSessionCookie = (): string =>
  [
    `${WEB_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

export const publicSessionPayload = (session: AccountSession | null) => {
  if (!session) {
    return { authenticated: false as const };
  }
  return {
    authenticated: true as const,
    session: {
      sessionId: session.sessionId,
      user: session.user,
      workspace: session.workspace,
      workspaces: session.workspaces,
    },
  };
};
