// @input: Request headers (Authorization: Bearer) + OMNIAGENT_API_KEYS env
// @output: AuthResult indicating ok/free-tier/denied
// @position: Thin auth gate for engine API routes

type AuthResult =
  | { ok: true; freeTier: boolean; keyId: string }
  | { ok: false; response: Response };

const getValidKeys = (): Set<string> => {
  const raw = process.env.OMNIAGENT_API_KEYS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
};

const extractBearer = (req: Request): string | undefined => {
  const auth = req.headers.get("authorization")?.trim();
  if (!auth) return undefined;
  const [scheme, token] = auth.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token?.trim()) return undefined;
  return token.trim();
};

const deny = (message: string): AuthResult => ({
  ok: false,
  response: Response.json(
    { error: { code: "unauthorized", message } },
    { status: 401 },
  ),
});

export const validateApiKey = (req: Request): AuthResult => {
  const token = extractBearer(req);
  const validKeys = getValidKeys();

  if (!token) {
    // No keys configured = allow as free tier
    if (validKeys.size === 0) {
      return { ok: true, freeTier: true, keyId: "anonymous" };
    }
    return deny("Missing Authorization: Bearer <api_key>");
  }

  if (validKeys.size > 0 && !validKeys.has(token)) {
    return deny("Invalid API key");
  }

  return { ok: true, freeTier: false, keyId: token.slice(0, 8) + "..." };
};
