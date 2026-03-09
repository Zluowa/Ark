// @input: Search queries, song IDs, cookies, and auth requests
// @output: Song metadata, authorized stream URLs, account summaries, and QR helpers
// @position: NetEase Cloud Music provider - server-side only

import { createRequire } from "node:module";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const REFERER = "https://music.163.com";
const neteaseRequire = createRequire(import.meta.url);

export type Song = {
  id: number;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number; // seconds
};

export type NeteaseAccountSummary = {
  userId: number;
  nickname: string;
  avatarUrl: string;
};

type NeteaseApiModule = typeof import("NeteaseCloudMusicApi");

type SearchResponse = {
  result?: {
    songs?: Array<{ id: number; name: string }>;
  };
};

type DetailResponse = {
  songs?: SongShape[];
};

type SongShape = {
  id?: number;
  name?: string;
  duration?: number;
  dt?: number;
  artists?: Array<{ name?: string }>;
  ar?: Array<{ name?: string }>;
  album?: { name?: string; picUrl?: string };
  al?: { name?: string; picUrl?: string };
};

type SongUrlResponse = {
  code?: number;
  data?: Array<{ id?: number; url?: string | null; code?: number }>;
};

type RecommendSongsResponse = {
  data?: {
    dailySongs?: SongShape[];
  };
  recommend?: SongShape[];
};

type UserAccountResponse = {
  account?: {
    id?: number;
    userName?: string;
    anonimousUser?: boolean;
    anonymousUser?: boolean;
  };
  profile?: { userId?: number; nickname?: string; avatarUrl?: string };
  data?: {
    account?: {
      id?: number;
      userName?: string;
      anonimousUser?: boolean;
      anonymousUser?: boolean;
    };
    profile?: { userId?: number; nickname?: string; avatarUrl?: string };
  };
};

type LikeListResponse = {
  ids?: number[];
};

let neteaseApiPromise: Promise<NeteaseApiModule> | null = null;

export async function loadNeteaseApi(): Promise<NeteaseApiModule> {
  if (!neteaseApiPromise) {
    neteaseApiPromise = Promise.resolve(
      neteaseRequire("NeteaseCloudMusicApi") as NeteaseApiModule,
    );
  }
  return neteaseApiPromise;
}

export async function createAnonymousNeteaseSession(): Promise<{
  cookie: string;
  account: NeteaseAccountSummary | null;
}> {
  const api = await loadNeteaseApi();
  const response = (await (api as any).register_anonimous({} as any)) as {
    body?: { code?: number; cookie?: string };
  };
  const cookie = response.body?.cookie?.trim();
  if (response.body?.code !== 200 || !cookie) {
    throw new Error("Failed to create anonymous NetEase session.");
  }
  const account = await fetchNeteaseAccountSummary(cookie);
  return { cookie, account };
}

export async function search(query: string, limit = 6): Promise<Song[]> {
  const res = await fetch("https://music.163.com/api/search/get", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Referer: REFERER,
    },
    body: `s=${encodeURIComponent(query)}&type=1&offset=0&limit=${limit}`,
    cache: "no-store",
  });
  if (!res.ok) return [];

  const data = (await res.json()) as SearchResponse;
  const ids = (data.result?.songs ?? []).map((song) => song.id).filter(Boolean);
  if (ids.length === 0) return [];
  return fetchDetails(ids);
}

export async function fetchDetails(ids: number[]): Promise<Song[]> {
  if (ids.length === 0) return [];
  const res = await fetch(
    `https://music.163.com/api/song/detail?ids=[${ids.join(",")}]`,
    {
      headers: { "User-Agent": UA, Referer: REFERER },
      cache: "no-store",
    },
  );
  if (!res.ok) return [];

  const data = (await res.json()) as DetailResponse;
  return (data.songs ?? []).map(mapSongShape).filter((song) => song.id > 0);
}

export function audioUrl(songId: number): string {
  return `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
}

export async function checkPlayable(
  songId: number,
  cookie?: string | null,
): Promise<string | null> {
  const trimmedCookie = cookie?.trim();
  if (trimmedCookie) {
    const authorized = await resolveAuthorizedSongUrl(songId, trimmedCookie);
    if (authorized) {
      return authorized;
    }
  }

  const url = audioUrl(songId);
  const res = await fetch(url, {
    redirect: "manual",
    cache: "no-store",
  });
  const location = res.headers.get("location") ?? "";
  if (location.includes("404") || location.length < 10) return null;
  return location;
}

export async function fetchNeteaseAccountSummary(
  cookie: string,
): Promise<NeteaseAccountSummary | null> {
  const api = await loadNeteaseApi();

  const account = (await api.user_account({
    cookie,
  } as any)) as { body?: UserAccountResponse };
  const fromAccount = parseAccountSummary(account.body);
  if (fromAccount) {
    return fromAccount;
  }

  const loginStatus = (await api.login_status({
    cookie,
  } as any)) as { body?: UserAccountResponse };
  return parseAccountSummary(loginStatus.body);
}

export async function fetchRecommendedSongs(
  cookie: string,
  limit = 6,
): Promise<Song[]> {
  const api = await loadNeteaseApi();
  const recommended = (await api.recommend_songs({
    cookie,
  } as any)) as { body?: RecommendSongsResponse };

  const dailySongs = recommended.body?.data?.dailySongs ?? [];
  if (dailySongs.length > 0) {
    return dailySongs.slice(0, limit).map(mapSongShape).filter((song) => song.id > 0);
  }

  const recommendSongs = recommended.body?.recommend ?? [];
  if (recommendSongs.length > 0) {
    return recommendSongs
      .slice(0, limit)
      .map(mapSongShape)
      .filter((song) => song.id > 0);
  }

  const fallback = await fetchLikedSongs(cookie, limit);
  return fallback;
}

export async function fetchLikedSongs(
  cookie: string,
  limit = 6,
): Promise<Song[]> {
  const account = await fetchNeteaseAccountSummary(cookie);
  if (!account) {
    return [];
  }

  const api = await loadNeteaseApi();
  const liked = (await api.likelist({
    cookie,
    uid: account.userId,
  } as any)) as { body?: LikeListResponse };

  const ids = (liked.body?.ids ?? []).slice(0, limit);
  return fetchDetails(ids);
}

async function resolveAuthorizedSongUrl(
  songId: number,
  cookie: string,
): Promise<string | null> {
  try {
    const api = await loadNeteaseApi();
    const response = (await api.song_url({
      id: songId,
      br: 320000,
      cookie,
    } as any)) as { body?: SongUrlResponse };
    const url = response.body?.data?.[0]?.url;
    return typeof url === "string" && url.trim() ? url : null;
  } catch {
    return null;
  }
}

function mapSongShape(song: SongShape): Song {
  const album = song.album ?? song.al;
  const artists = song.artists ?? song.ar ?? [];
  return {
    id: Number(song.id ?? 0),
    name: String(song.name ?? "").trim(),
    artist: artists
      .map((artist) => String(artist?.name ?? "").trim())
      .filter(Boolean)
      .join(", "),
    album: String(album?.name ?? "").trim(),
    cover: album?.picUrl ? `${album.picUrl}?param=200y200` : "",
    duration: Math.round(Number(song.duration ?? song.dt ?? 0) / 1000),
  };
}

function parseAccountSummary(
  body: UserAccountResponse | undefined,
): NeteaseAccountSummary | null {
  const profile = body?.profile ?? body?.data?.profile;
  const account = body?.account ?? body?.data?.account;
  const userId = Number(profile?.userId ?? account?.id ?? 0);
  const profileNickname = String(profile?.nickname ?? "").trim();
  const guest =
    Boolean(account?.anonimousUser) || Boolean(account?.anonymousUser);
  const nickname = profileNickname || (guest ? "Cloud Music Guest" : "");
  if (!userId || !nickname) {
    return null;
  }
  return {
    userId,
    nickname,
    avatarUrl: String(profile?.avatarUrl ?? "").trim(),
  };
}
