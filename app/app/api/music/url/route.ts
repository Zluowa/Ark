// @input: ?id=songId
// @output: Proxied audio stream (avoids CORS + mixed content)
// @position: Audio stream proxy - tenant-scoped NetEase auth aware

import { audioUrl, checkPlayable } from "@/lib/music/netease";
import { resolveOptionalIdentity } from "@/lib/server/access-control";
import { credentialStore } from "@/lib/server/credential-store";
import { toResponse } from "@/lib/shared/result";

export async function GET(req: Request) {
  const access = resolveOptionalIdentity(req);
  if (!access.ok) return toResponse(access);

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id || !Number.isFinite(id)) {
    return Response.json({ error: "Missing ?id= parameter" }, { status: 400 });
  }

  const credential = access.identity
    ? await credentialStore.get(access.identity.tenantId, "netease")
    : null;
  const activeCredential =
    credential?.status === "active" ? credential.credential : undefined;

  const resolved = await checkPlayable(id, activeCredential);
  const target = resolved ?? audioUrl(id);

  const upstream = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Referer: "https://music.163.com",
    },
    cache: "no-store",
  });

  const ct = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !upstream.body || !ct.startsWith("audio/")) {
    return Response.json({ error: "Audio unavailable" }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  };
  const cl = upstream.headers.get("content-length");
  if (cl) headers["Content-Length"] = cl;

  return new Response(upstream.body, { status: 200, headers });
}
