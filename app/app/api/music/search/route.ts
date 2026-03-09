// @input: ?q=search+query&limit=6
// @output: JSON array of songs with metadata and playability
// @position: Music search API - optionally enriches with tenant-scoped NetEase auth

import { checkPlayable, search } from "@/lib/music/netease";
import { resolveOptionalIdentity } from "@/lib/server/access-control";
import { credentialStore } from "@/lib/server/credential-store";
import { toResponse } from "@/lib/shared/result";

export async function GET(req: Request) {
  const access = resolveOptionalIdentity(req);
  if (!access.ok) return toResponse(access);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ error: "Missing ?q= parameter" }, { status: 400 });
  }
  const limit = Math.min(
    10,
    Math.max(1, Number(searchParams.get("limit")) || 6),
  );
  const credential = access.identity
    ? await credentialStore.get(access.identity.tenantId, "netease")
    : null;
  const activeCredential =
    credential?.status === "active" ? credential.credential : undefined;

  const songs = await search(q, limit);
  const withPlayable = await Promise.all(
    songs.map(async (song) => {
      const url = await checkPlayable(song.id, activeCredential);
      return { ...song, playable: url !== null, stream_url: url };
    }),
  );

  const ranked = await rankSongs(q, withPlayable);
  return Response.json({
    songs: ranked,
    authorized: Boolean(activeCredential),
  });
}

type SearchSong = {
  id: number;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  playable: boolean;
  stream_url: string | null;
};

async function rankSongs(query: string, songs: SearchSong[]) {
  const lyricSignals = await Promise.all(
    songs.slice(0, Math.min(4, songs.length)).map(async (song) => ({
      id: song.id,
      firstLyricMs: await fetchFirstMeaningfulLyricMs(song.id),
    })),
  );
  const lyricMap = new Map(
    lyricSignals.map((item) => [item.id, item.firstLyricMs]),
  );
  const normalizedQuery = normalize(query);
  return [...songs].sort((left, right) => {
    const scoreRight = scoreSong(
      right,
      normalizedQuery,
      lyricMap.get(right.id) ?? null,
    );
    const scoreLeft = scoreSong(
      left,
      normalizedQuery,
      lyricMap.get(left.id) ?? null,
    );
    return scoreRight - scoreLeft;
  });
}

function scoreSong(
  song: SearchSong,
  normalizedQuery: string,
  firstLyricMs: number | null,
) {
  let score = song.playable ? 1000 : -1000;
  const name = normalize(song.name);
  const artist = normalize(song.artist);
  const album = normalize(song.album);

  if (
    normalizedQuery &&
    (name.includes(normalizedQuery) || artist.includes(normalizedQuery))
  ) {
    score += 180;
  }
  if (name === normalizedQuery) {
    score += 120;
  }
  if (!/[()锛堬級\[\]]/.test(song.name)) {
    score += 40;
  }
  if (album && name === album) {
    score += 18;
  }

  const lowered = `${song.name} ${song.artist}`.toLowerCase();
  const penaltyWords = [
    "cover",
    "鍘熷敱",
    "濂冲０鐗?",
    "閽㈢惔",
    "浼村",
    "娣辨儏鐗?",
    "鏌旀儏鐗?",
    "live",
  ];
  for (const word of penaltyWords) {
    if (lowered.includes(word.toLowerCase())) {
      score -= 140;
    }
  }

  if (firstLyricMs !== null) {
    score += Math.max(0, 260 - Math.floor(firstLyricMs / 160));
  }

  return score;
}

async function fetchFirstMeaningfulLyricMs(songId: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://music.163.com",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as {
      lrc?: { lyric?: string };
    };
    const lyric = data.lrc?.lyric ?? "";
    if (!lyric) {
      return null;
    }
    for (const line of lyric.split("\n")) {
      const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (!match) {
        continue;
      }
      const text = match[3]?.trim() ?? "";
      if (!text || isMetadataLyric(text)) {
        continue;
      }
      const mins = Number(match[1]);
      const secs = Number(match[2]);
      return Math.round(mins * 60_000 + secs * 1000);
    }
    return null;
  } catch {
    return null;
  }
}

function isMetadataLyric(text: string) {
  const normalized = text.replace(/\s+/g, "");
  if (!normalized) {
    return true;
  }
  const metadataPrefixes = [
    "浣滆瘝",
    "浣滄洸",
    "缂栨洸",
    "鍒朵綔",
    "褰曢煶",
    "娣烽煶",
    "鍜屽０",
    "鍚変粬",
    "璐濇柉",
    "榧?",
    "璇嶏細",
    "鏇诧細",
    "缂栨洸锛?",
    "prod.",
    "producer",
  ];
  return metadataPrefixes.some((prefix) =>
    normalized.toLowerCase().startsWith(prefix.toLowerCase()),
  );
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
