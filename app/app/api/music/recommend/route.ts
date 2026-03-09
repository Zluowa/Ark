// @input: GET with optional ?limit=
// @output: authorized NetEase recommendation songs with playability
// @position: Music recommendation API - requires a tenant-scoped NetEase credential

import { checkPlayable, fetchRecommendedSongs } from "@/lib/music/netease";
import { authorizeRequest } from "@/lib/server/access-control";
import { credentialStore } from "@/lib/server/credential-store";
import { toResponse } from "@/lib/shared/result";

export async function GET(req: Request) {
  const access = authorizeRequest(req, "execute:write");
  if (!access.ok) return toResponse(access);

  const { searchParams } = new URL(req.url);
  const limit = Math.min(
    10,
    Math.max(1, Number(searchParams.get("limit")) || 6),
  );
  const credential = await credentialStore.get(
    access.identity.tenantId,
    "netease",
  );
  if (!credential || credential.status !== "active") {
    return Response.json(
      { error: "NetEase account not connected." },
      { status: 401 },
    );
  }

  const songs = await fetchRecommendedSongs(credential.credential, limit);
  const playableSongs = await Promise.all(
    songs.map(async (song) => {
      const url = await checkPlayable(song.id, credential.credential);
      return { ...song, playable: url !== null, stream_url: url };
    }),
  );

  return Response.json({
    songs: playableSongs.filter((song) => song.playable),
    authorized: true,
    context_label: "For you",
  });
}
