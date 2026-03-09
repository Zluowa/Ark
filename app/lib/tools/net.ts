// @input: domains, IPs, music queries, and web-search prompts
// @output: DNS data, IP geo info, music candidates, Tavily web results
// @position: Network-facing utility tools

import { promises as dns } from "node:dns";
import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";

const ok = (
  data: Record<string, unknown>,
  start: number,
): ReturnType<ToolHandler> =>
  Promise.resolve({
    status: "success",
    output: data,
    duration_ms: Date.now() - start,
  });

const fail = (
  code: string,
  message: string,
  start: number,
): ReturnType<ToolHandler> =>
  Promise.resolve({
    status: "failed",
    error: { code, message },
    duration_ms: Date.now() - start,
  });

const str = (params: Record<string, unknown>, key: string): string =>
  String(params[key] ?? "").trim();

const num = (
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number => {
  const value = Number(params[key]);
  if (!Number.isFinite(value)) return fallback;
  return value;
};

const bool = (
  params: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean => {
  const value = params[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const parseDomainList = (value: string): string[] =>
  value
    .split(/[,\s]+/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);

/* -------------------------------------------------------------------------- */
/* DNS lookup                                                                  */
/* -------------------------------------------------------------------------- */

const dnsLookupManifest: ToolManifest = {
  id: "net.dns_lookup",
  name: "DNS Lookup",
  description:
    "Resolve DNS records for a domain (A, AAAA, MX, TXT, CNAME, NS, or ALL).",
  category: "net",
  tags: ["dns", "lookup", "domain", "network"],
  params: [
    {
      name: "domain",
      type: "string",
      required: true,
      description: "Domain name to resolve",
    },
    {
      name: "type",
      type: "enum",
      required: false,
      default: "A",
      description: "DNS record type",
      enum_values: ["A", "AAAA", "MX", "TXT", "CNAME", "NS", "ALL"],
    },
  ],
  output_type: "json",
  keywords: ["dns", "lookup", "domain", "resolve", "域名解析"],
  patterns: ["dns.*lookup", "lookup.*domain", "nslookup", "dig.*domain"],
};

type DnsResult = Record<string, unknown>;

const lookupRecord = async (domain: string, type: string): Promise<DnsResult> => {
  const resolvers: Record<string, () => Promise<unknown>> = {
    A: () => dns.resolve4(domain),
    AAAA: () => dns.resolve6(domain),
    MX: () => dns.resolveMx(domain),
    TXT: () => dns.resolveTxt(domain),
    CNAME: () => dns.resolveCname(domain),
    NS: () => dns.resolveNs(domain),
  };

  const resolver = resolvers[type];
  if (!resolver) {
    throw new Error(`Unsupported record type: ${type}`);
  }
  const result = await resolver();
  return { [type]: result };
};

const dnsLookupHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const domain = str(params, "domain");
  if (!domain) return fail("EMPTY_DOMAIN", "Domain cannot be empty", start);
  const type = str(params, "type").toUpperCase() || "A";

  try {
    if (type === "ALL") {
      const types = ["A", "AAAA", "MX", "TXT", "CNAME", "NS"];
      const results: DnsResult = { domain };
      await Promise.allSettled(
        types.map(async (recordType) => {
          try {
            Object.assign(results, await lookupRecord(domain, recordType));
          } catch {
            results[recordType] = null;
          }
        }),
      );
      return ok({ json: results, text: JSON.stringify(results, null, 2) }, start);
    }

    const result = await lookupRecord(domain, type);
    const payload = { domain, ...result };
    return ok({ json: payload, text: JSON.stringify(payload, null, 2) }, start);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("DNS_ERROR", `DNS lookup failed: ${message}`, start);
  }
};

export const dnsLookup: ToolRegistryEntry = {
  manifest: dnsLookupManifest,
  handler: dnsLookupHandler,
};

/* -------------------------------------------------------------------------- */
/* IP info                                                                     */
/* -------------------------------------------------------------------------- */

const ipInfoManifest: ToolManifest = {
  id: "net.ip_info",
  name: "IP Info",
  description: "Get geolocation and network info for an IP address.",
  category: "net",
  tags: ["ip", "geolocation", "network", "lookup"],
  params: [
    {
      name: "ip",
      type: "string",
      required: true,
      description: "IPv4 or IPv6 address",
    },
  ],
  output_type: "json",
  keywords: ["ip", "geolocation", "location", "network", "lookup", "IP查询"],
  patterns: ["ip.*info", "ip.*lookup", "ip.*location", "whois.*ip"],
};

interface IpApiResponse {
  status: string;
  message?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  query?: string;
}

const ipInfoHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const ip = str(params, "ip");
  if (!ip) return fail("EMPTY_IP", "IP address cannot be empty", start);

  try {
    const endpoint =
      `http://ip-api.com/json/${encodeURIComponent(ip)}` +
      "?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query";
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      return fail("API_ERROR", `ip-api.com returned ${response.status}`, start);
    }
    const data = (await response.json()) as IpApiResponse;
    if (data.status !== "success") {
      return fail("LOOKUP_FAILED", data.message ?? "IP lookup failed", start);
    }
    return ok({ json: data, text: JSON.stringify(data, null, 2) }, start);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("NETWORK_ERROR", `Failed to reach ip-api.com: ${message}`, start);
  }
};

export const ipInfo: ToolRegistryEntry = {
  manifest: ipInfoManifest,
  handler: ipInfoHandler,
};

/* -------------------------------------------------------------------------- */
/* Tavily web search                                                           */
/* -------------------------------------------------------------------------- */

const webSearchManifest: ToolManifest = {
  id: "web.search",
  name: "Web Search (Tavily)",
  description:
    "Search the web with Tavily and return concise answer, references, and optional images.",
  category: "net",
  tags: ["web", "search", "tavily", "research", "news"],
  params: [
    {
      name: "query",
      type: "string",
      required: true,
      description: "Search query",
    },
    {
      name: "search_depth",
      type: "enum",
      required: false,
      default: "basic",
      description: "Search depth",
      enum_values: ["basic", "advanced"],
    },
    {
      name: "max_results",
      type: "number",
      required: false,
      default: 5,
      description: "Max number of results (1-10)",
      min: 1,
      max: 10,
    },
    {
      name: "include_images",
      type: "boolean",
      required: false,
      default: false,
      description: "Whether to include related images",
    },
    {
      name: "include_answer",
      type: "boolean",
      required: false,
      default: true,
      description: "Whether Tavily should return a direct answer summary",
    },
    {
      name: "include_domains",
      type: "string",
      required: false,
      description: "Comma-separated domains to include",
    },
    {
      name: "exclude_domains",
      type: "string",
      required: false,
      description: "Comma-separated domains to exclude",
    },
  ],
  output_type: "json",
  keywords: ["web search", "search web", "tavily", "research", "联网搜索", "搜索网页"],
  patterns: ["web.*search", "search.*web", "tavily", "联网.*搜索", "搜索.*网页"],
};

interface TavilyResultItem {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  query?: string;
  answer?: string;
  results?: TavilyResultItem[];
  images?: string[];
}

const webSearchHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const query =
    str(params, "query") ||
    str(params, "q") ||
    str(params, "keyword") ||
    str(params, "text");
  if (!query) {
    return fail("EMPTY_QUERY", "Search query cannot be empty", start);
  }

  const apiKey =
    process.env.TAVILY_API_KEY?.trim() ||
    process.env.OMNIAGENT_TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return fail(
      "NO_TAVILY_KEY",
      "Missing TAVILY_API_KEY (or OMNIAGENT_TAVILY_API_KEY).",
      start,
    );
  }

  const endpoint =
    process.env.TAVILY_API_URL?.trim() || "https://api.tavily.com/search";
  const depth =
    str(params, "search_depth").toLowerCase() === "advanced"
      ? "advanced"
      : "basic";
  const maxResults = Math.max(1, Math.min(10, Math.floor(num(params, "max_results", 5))));
  const includeImages = bool(params, "include_images", false);
  const includeAnswer = bool(params, "include_answer", true);
  const includeDomains = parseDomainList(str(params, "include_domains"));
  const excludeDomains = parseDomainList(str(params, "exclude_domains"));

  const requestBody: Record<string, unknown> = {
    api_key: apiKey,
    query,
    search_depth: depth,
    include_images: includeImages,
    include_answer: includeAnswer,
    max_results: maxResults,
  };
  if (includeDomains.length > 0) requestBody.include_domains = includeDomains;
  if (excludeDomains.length > 0) requestBody.exclude_domains = excludeDomains;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      return fail(
        "TAVILY_HTTP_ERROR",
        `Tavily returned ${response.status}: ${text.slice(0, 500)}`,
        start,
      );
    }

    const data = (await response.json()) as TavilyResponse;
    const results = (Array.isArray(data.results) ? data.results : [])
      .slice(0, maxResults)
      .map((item) => ({
        title: String(item.title ?? "").trim(),
        url: String(item.url ?? "").trim(),
        content: String(item.content ?? "").trim(),
        score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
        published_date: item.published_date ?? null,
      }))
      .filter((item) => item.url.length > 0);
    const images = (Array.isArray(data.images) ? data.images : [])
      .map((url) => String(url ?? "").trim())
      .filter(Boolean);

    const lines: string[] = [];
    if (typeof data.answer === "string" && data.answer.trim()) {
      lines.push(`Answer: ${data.answer.trim()}`);
    }
    if (results.length > 0) {
      lines.push(
        ...results
          .slice(0, 3)
          .map(
            (item, index) =>
              `${index + 1}. ${item.title || "Untitled"} - ${item.url}`,
          ),
      );
    }

    return ok(
      {
        query: data.query ?? query,
        answer: data.answer ?? "",
        results,
        images,
        count: results.length,
        response_time_ms: Date.now() - start,
        text: lines.join("\n"),
      },
      start,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("NETWORK_ERROR", `Tavily request failed: ${message}`, start);
  }
};

export const webSearch: ToolRegistryEntry = {
  manifest: webSearchManifest,
  handler: webSearchHandler,
};

/* -------------------------------------------------------------------------- */
/* NetEase music search                                                        */
/* -------------------------------------------------------------------------- */

const musicSearchManifest: ToolManifest = {
  id: "net.music_search",
  name: "Music Search",
  description: "Search songs on NetEase Cloud Music and return playable tracks.",
  category: "net",
  tags: ["music", "search", "netease", "song", "player"],
  params: [
    {
      name: "query",
      type: "string",
      required: false,
      description: "Song name, artist, or keywords",
    },
    {
      name: "keyword",
      type: "string",
      required: false,
      description: "Alias of query",
    },
    {
      name: "song",
      type: "string",
      required: false,
      description: "Alias of query",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      default: 3,
      description: "Number of results (1-10)",
      min: 1,
      max: 10,
    },
  ],
  output_type: "json",
  keywords: ["music", "song", "search", "netease", "play", "音乐", "搜歌"],
  patterns: ["music.*search", "search.*song", "play.*music", "搜歌", "点歌"],
};

interface NeteaseSearchResult {
  result?: {
    songs?: Array<{
      id: number;
      name: string;
      artists: Array<{ id: number; name: string }>;
      album: { id: number; name: string; picUrl?: string };
      duration: number;
    }>;
  };
}

const audioUrl = (id: number): string =>
  `https://music.163.com/song/media/outer/url?id=${id}.mp3`;

const isPlayable = async (id: number): Promise<boolean> => {
  try {
    const response = await fetch(audioUrl(id), {
      redirect: "manual",
      cache: "no-store",
    });
    const location = response.headers.get("location") ?? "";
    return location.length > 10 && !location.includes("404");
  } catch {
    return false;
  }
};

const musicSearchHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const query =
    str(params, "query") ||
    str(params, "keyword") ||
    str(params, "song") ||
    str(params, "name") ||
    str(params, "artist") ||
    str(params, "text");
  if (!query) return fail("EMPTY_QUERY", "Search query cannot be empty", start);

  const limit = Math.max(1, Math.min(10, Math.floor(num(params, "limit", 6))));

  try {
    const fetchLimit = Math.min(20, limit * 3);
    const searchUrl =
      `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}` +
      `&type=1&offset=0&limit=${fetchLimit}`;

    const searchResp = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://music.163.com",
      },
      cache: "no-store",
    });
    if (!searchResp.ok) {
      return fail(
        "API_ERROR",
        `NetEase API returned ${searchResp.status}`,
        start,
      );
    }

    const searchData = (await searchResp.json()) as NeteaseSearchResult;
    const rawSongs = searchData.result?.songs ?? [];
    if (rawSongs.length === 0) {
      return ok(
        { json: { query, songs: [], count: 0 }, text: "No results found" },
        start,
      );
    }

    const ids = rawSongs.map((song) => song.id).join(",");
    const detailResp = await fetch(
      `https://music.163.com/api/song/detail?ids=[${ids}]`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://music.163.com",
        },
        cache: "no-store",
      },
    );
    const detailData = detailResp.ok
      ? ((await detailResp.json()) as {
          songs?: Array<{
            id: number;
            name: string;
            artists?: Array<{ name: string }>;
            album?: { name: string; picUrl?: string };
            duration?: number;
          }>;
        })
      : { songs: [] };
    const detailMap = new Map(
      (detailData.songs ?? []).map((song) => [song.id, song]),
    );

    const playableFlags = await Promise.all(
      rawSongs.map((song) => isPlayable(song.id)),
    );

    const songs = rawSongs
      .map((song, index) => {
        const detail = detailMap.get(song.id);
        return {
          id: song.id,
          name: detail?.name ?? song.name,
          artist: (detail?.artists ?? song.artists).map((a) => a.name).join(", "),
          album: detail?.album?.name ?? song.album.name,
          cover: detail?.album?.picUrl
            ? `${detail.album.picUrl}?param=200y200`
            : null,
          duration: Math.round(((detail?.duration ?? song.duration) || 0) / 1000),
          playable: playableFlags[index],
        };
      })
      .filter((song) => song.playable)
      .slice(0, limit);

    return ok(
      {
        json: { query, songs, count: songs.length },
        text: songs.map((song) => `${song.name} - ${song.artist}`).join("\n"),
      },
      start,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("NETWORK_ERROR", `Music search failed: ${message}`, start);
  }
};

export const musicSearch: ToolRegistryEntry = {
  manifest: musicSearchManifest,
  handler: musicSearchHandler,
};

