// @input: Video URLs from Bilibili, Douyin, YouTube, Xiaohongshu
// @output: ToolRegistryEntry objects for 4 media tools (info/video/audio/subtitle)
// @position: Multi-platform media download via public APIs + ffmpeg + server-side proxy

import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { tempFile, runCommand } from "./helpers";

/* ── Shared types ── */

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  platform: string;
  view_count: number;
  formats: Array<{ format_id: string; ext: string; resolution: string; note: string }>;
  subtitles_available?: Array<{ lan: string; lan_doc: string }>;
}

interface SubtitleEntry { index: number; start: string; end: string; text: string }

/* ── Shared utilities ── */

function tryUnlink(...paths: string[]): void {
  for (const p of paths) try { unlinkSync(p); } catch { /* ok */ }
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function secondsToSrt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

async function streamToFile(url: string, dest: string, headers: Record<string, string>): Promise<void> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`下载流失败: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

/* ══════════════════════════════════════════════════════════
   Bilibili — Public API (no login: max 480p DASH)
   ══════════════════════════════════════════════════════════ */

const BILI_H = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer": "https://www.bilibili.com",
};

async function biliGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: BILI_H });
  if (!res.ok) throw new Error(`Bilibili API ${res.status}`);
  const json = await res.json() as Record<string, unknown>;
  if (json.code !== 0) throw new Error(`Bilibili ${json.code}: ${json.message}`);
  return json.data as Record<string, unknown>;
}

async function parseBvid(url: string): Promise<string> {
  const n = url.startsWith("http") ? url : `https://${url}`;
  if (n.includes("b23.tv")) {
    const res = await fetch(n, { headers: BILI_H });
    return parseBvid(res.url);
  }
  const bv = n.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  if (bv) return bv[1];
  throw new Error("无法识别的B站链接，请提供 bilibili.com/video/BVxxx 格式");
}

async function biliInfo(url: string): Promise<VideoInfo> {
  const bvid = await parseBvid(url);
  const d = await biliGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const owner = d.owner as Record<string, unknown>;
  const stat = d.stat as Record<string, unknown>;

  const subData = await biliGet(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${(d.pages as Array<Record<string, unknown>>)[0].cid}`);
  const subs = ((subData.subtitle as Record<string, unknown>)?.subtitles ?? []) as Array<Record<string, unknown>>;

  return {
    title: d.title as string,
    thumbnail: d.pic as string,
    duration: d.duration as number,
    uploader: owner.name as string,
    platform: "bilibili",
    view_count: stat.view as number,
    formats: [{ format_id: "dash-480p", ext: "mp4", resolution: "854x480", note: "无登录最高480p" }],
    subtitles_available: subs.map((s) => ({ lan: s.lan as string, lan_doc: s.lan_doc as string })),
  };
}

async function biliDownloadVideo(url: string): Promise<{ path: string; title: string; duration: number }> {
  const bvid = await parseBvid(url);
  const d = await biliGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const cid = (d.pages as Array<Record<string, unknown>>)[0].cid as number;
  const play = await biliGet(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=16`);
  const dash = play.dash as Record<string, unknown>;
  const videos = dash.video as Array<Record<string, unknown>>;
  const audios = dash.audio as Array<Record<string, unknown>>;
  if (!videos?.length || !audios?.length) throw new Error("无法获取视频流");

  const vTmp = tempFile("m4s"), aTmp = tempFile("m4s"), out = tempFile("mp4");
  try {
    await Promise.all([
      streamToFile(videos[0].baseUrl as string, vTmp, BILI_H),
      streamToFile(audios[0].baseUrl as string, aTmp, BILI_H),
    ]);
    const r = await runCommand("ffmpeg", ["-y", "-i", vTmp, "-i", aTmp, "-c", "copy", out], 300_000);
    if (r.exitCode !== 0) throw new Error(`ffmpeg合并失败: ${r.stderr.slice(0, 200)}`);
    return { path: out, title: d.title as string, duration: d.duration as number };
  } finally {
    tryUnlink(vTmp, aTmp);
  }
}

async function biliDownloadAudio(url: string): Promise<{ path: string; title: string; duration: number }> {
  const bvid = await parseBvid(url);
  const d = await biliGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const cid = (d.pages as Array<Record<string, unknown>>)[0].cid as number;
  const play = await biliGet(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=16`);
  const audios = (play.dash as Record<string, unknown>).audio as Array<Record<string, unknown>>;
  if (!audios?.length) throw new Error("无法获取音频流");

  const aTmp = tempFile("m4s"), out = tempFile("mp3");
  try {
    await streamToFile(audios[0].baseUrl as string, aTmp, BILI_H);
    const r = await runCommand("ffmpeg", ["-y", "-i", aTmp, "-c:a", "libmp3lame", "-q:a", "0", out], 300_000);
    if (r.exitCode !== 0) throw new Error(`ffmpeg失败: ${r.stderr.slice(0, 200)}`);
    return { path: out, title: d.title as string, duration: d.duration as number };
  } finally {
    tryUnlink(aTmp);
  }
}

async function biliSubtitles(url: string, lang: string): Promise<{ title: string; language: string; entries: SubtitleEntry[] }> {
  const bvid = await parseBvid(url);
  const d = await biliGet(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const cid = (d.pages as Array<Record<string, unknown>>)[0].cid as number;
  const sub = await biliGet(`https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`);
  const subs = ((sub.subtitle as Record<string, unknown>)?.subtitles ?? []) as Array<Record<string, unknown>>;
  if (!subs.length) throw new Error("该视频没有可用字幕");

  const picked = subs.find((s) => (s.lan as string).startsWith(lang)) ?? subs[0];
  const res = await fetch(`https:${picked.subtitle_url}`, { headers: BILI_H });
  if (!res.ok) throw new Error(`下载字幕失败: ${res.status}`);
  const raw = await res.json() as { body: Array<{ from: number; to: number; content: string }> };

  return {
    title: d.title as string,
    language: picked.lan_doc as string,
    entries: raw.body.map((item, i) => ({
      index: i + 1,
      start: secondsToSrt(item.from),
      end: secondsToSrt(item.to),
      text: item.content,
    })),
  };
}

/* ══════════════════════════════════════════════════════════
   Douyin — iesdouyin SSR share page (720p, watermark)
   ══════════════════════════════════════════════════════════ */

const DY_H = { "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36" };

function parseDouyinId(url: string): string {
  const n = url.startsWith("http") ? url : `https://${url}`;
  const m = n.match(/video\/(\d+)/);
  if (m) return m[1];
  throw new Error("无法识别的抖音链接，请提供 douyin.com/video/{ID} 格式");
}

type DouyinItem = {
  desc: string;
  author: { nickname: string };
  video: {
    play_addr: { url_list: string[] };
    cover: { url_list: string[] };
    duration: number;
    width: number;
    height: number;
  };
  statistics: { digg_count: number; play_count: number; comment_count: number };
};

async function douyinFetchItem(awemeId: string): Promise<DouyinItem> {
  const res = await fetch(`https://www.iesdouyin.com/share/video/${awemeId}/`, { headers: DY_H });
  if (!res.ok) throw new Error(`抖音页面请求失败: ${res.status}`);
  const html = await res.text();
  const match = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/);
  if (!match) throw new Error("无法解析抖音页面数据");
  const data = JSON.parse(match[1].trim());
  const page = data.loaderData?.["video_(id)/page"];
  const items = page?.videoInfoRes?.item_list as DouyinItem[] | undefined;
  if (!items?.length) {
    const filter = page?.videoInfoRes?.filter_list;
    const reason = filter?.[0]?.filter_reason ?? "未知原因";
    throw new Error(`抖音视频不可用: ${reason}`);
  }
  return items[0];
}

async function douyinInfo(url: string): Promise<VideoInfo> {
  const item = await douyinFetchItem(parseDouyinId(url));
  return {
    title: item.desc,
    thumbnail: item.video.cover.url_list[0],
    duration: Math.round(item.video.duration / 1000),
    uploader: item.author.nickname,
    platform: "douyin",
    view_count: item.statistics.digg_count,
    formats: [{
      format_id: "mp4-720p",
      ext: "mp4",
      resolution: `${item.video.width}x${item.video.height}`,
      note: "720p 有水印",
    }],
  };
}

async function douyinDownloadVideo(url: string): Promise<{ path: string; title: string; duration: number }> {
  const item = await douyinFetchItem(parseDouyinId(url));
  const videoUrl = item.video.play_addr.url_list[0];
  if (!videoUrl) throw new Error("无法获取抖音视频下载地址");
  const out = tempFile("mp4");
  await streamToFile(videoUrl, out, DY_H);
  return { path: out, title: item.desc, duration: Math.round(item.video.duration / 1000) };
}

async function douyinDownloadAudio(url: string): Promise<{ path: string; title: string; duration: number }> {
  const item = await douyinFetchItem(parseDouyinId(url));
  const videoUrl = item.video.play_addr.url_list[0];
  if (!videoUrl) throw new Error("无法获取抖音视频下载地址");
  const vTmp = tempFile("mp4"), out = tempFile("mp3");
  try {
    await streamToFile(videoUrl, vTmp, DY_H);
    const r = await runCommand("ffmpeg", ["-y", "-i", vTmp, "-vn", "-c:a", "libmp3lame", "-q:a", "0", out], 300_000);
    if (r.exitCode !== 0) throw new Error(`ffmpeg失败: ${r.stderr.slice(0, 200)}`);
    return { path: out, title: item.desc, duration: Math.round(item.video.duration / 1000) };
  } finally {
    tryUnlink(vTmp);
  }
}

/* ══════════════════════════════════════════════════════════
   YouTube — yt-dlp + 服务端代理 + cookie认证
   需要: yt-dlp + ffmpeg, MEDIA_PROXY/HTTPS_PROXY 配置代理
   认证: .omniagent-state/youtube-cookies.txt (一次性设置)
   ══════════════════════════════════════════════════════════ */

const YT_COOKIES_PATH = `${process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() || `${process.cwd()}/.omniagent-state`}/youtube-cookies.txt`;
const YT_AUTH_MSG = "YouTube需要登录认证。请前往 设置 → 连接 授权YouTube账号，或运行: node scripts/youtube-setup.mjs";

function parseYtId(url: string): string {
  const m = url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  throw new Error("无法识别的YouTube链接");
}

function ytBaseArgs(): string[] {
  const proxy = process.env.MEDIA_PROXY || process.env.HTTPS_PROXY || "";
  const args: string[] = [];
  if (proxy) args.push("--proxy", proxy);
  args.push("--js-runtimes", `node:${process.execPath}`);
  if (existsSync(YT_COOKIES_PATH)) args.push("--cookies", YT_COOKIES_PATH);
  return args;
}

function throwYtError(stderr: string): never {
  if (stderr.includes("Sign in") || stderr.includes("bot")) throw new Error(YT_AUTH_MSG);
  if (stderr.includes("ENOENT")) throw new Error("yt-dlp未安装。请运行: pip install yt-dlp");
  throw new Error(`YouTube错误: ${stderr.slice(0, 300)}`);
}

type YtDlpMeta = { title?: string; thumbnail?: string; duration?: number; uploader?: string; channel?: string; view_count?: number; formats?: Array<{ format_id: string; ext: string; vcodec: string; height?: number; width?: number; resolution?: string; format_note?: string }> };

async function ytInfo(url: string): Promise<VideoInfo> {
  const r = await runCommand("yt-dlp", [...ytBaseArgs(), "-j", url], 60_000);
  if (r.exitCode !== 0) throwYtError(r.stderr);
  const d = JSON.parse(r.stdout) as YtDlpMeta;
  const seen = new Set<string>();
  const fmts = (d.formats ?? [])
    .filter((f) => f.vcodec !== "none" && f.ext === "mp4" && f.height)
    .map((f) => ({ format_id: String(f.format_id), ext: "mp4", resolution: f.resolution ?? `${f.width}x${f.height}`, note: `${f.format_note ?? ""} 服务端代理下载`.trim() }))
    .filter((f) => { if (seen.has(f.resolution)) return false; seen.add(f.resolution); return true; });
  return {
    title: d.title ?? "", thumbnail: d.thumbnail ?? "", duration: d.duration ?? 0,
    uploader: d.uploader ?? d.channel ?? "", platform: "youtube", view_count: d.view_count ?? 0, formats: fmts,
  };
}

async function ytDownloadVideo(url: string): Promise<{ path: string; title: string; duration: number }> {
  const infoR = await runCommand("yt-dlp", [...ytBaseArgs(), "-j", url], 60_000);
  if (infoR.exitCode !== 0) throwYtError(infoR.stderr);
  const d = JSON.parse(infoR.stdout) as YtDlpMeta;
  const out = tempFile("mp4");
  const dlR = await runCommand("yt-dlp", [
    ...ytBaseArgs(), "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best",
    "--merge-output-format", "mp4", "--no-part", "-o", out, url,
  ], 600_000);
  if (dlR.exitCode !== 0) { tryUnlink(out); throwYtError(dlR.stderr); }
  return { path: out, title: d.title ?? "YouTube Video", duration: d.duration ?? 0 };
}

async function ytDownloadAudio(url: string): Promise<{ path: string; title: string; duration: number }> {
  const infoR = await runCommand("yt-dlp", [...ytBaseArgs(), "-j", url], 60_000);
  if (infoR.exitCode !== 0) throwYtError(infoR.stderr);
  const d = JSON.parse(infoR.stdout) as YtDlpMeta;
  const out = tempFile("mp3");
  const dlR = await runCommand("yt-dlp", [
    ...ytBaseArgs(), "-x", "--audio-format", "mp3", "--audio-quality", "0",
    "--no-part", "-o", out, url,
  ], 600_000);
  if (dlR.exitCode !== 0) { tryUnlink(out); throwYtError(dlR.stderr); }
  return { path: out, title: d.title ?? "YouTube Video", duration: d.duration ?? 0 };
}

/* ══════════════════════════════════════════════════════════
   Xiaohongshu — via XHS-Downloader Docker API (port 5556)
   ══════════════════════════════════════════════════════════ */

type XhsNote = {
  title?: string;
  desc?: string;
  user?: { nickname?: string };
  author?: { nickname?: string };
  image_list?: Array<{ url?: string; url_default?: string }>;
  video?: { media?: { stream?: { h264?: Array<{ master_url?: string; backup_urls?: string[] }> } } };
  video_info_v2?: { media?: { stream?: { h264?: Array<{ master_url?: string; backup_urls?: string[] }> } } };
  interact_info?: { liked_count?: string; view_count?: string };
  type?: string;
};

async function getXhsCookie(params: Record<string, unknown>): Promise<string> {
  const ctx = params._context as { tenantId?: string } | undefined;
  if (ctx?.tenantId) {
    const { credentialStore } = await import("@/lib/server/credential-store");
    const cred = await credentialStore.get(ctx.tenantId, "xhs");
    if (cred?.status === "active") return cred.credential;
  }
  if (process.env.XHS_COOKIE) return process.env.XHS_COOKIE;
  throw new Error("小红书需要授权。请前往 设置 → 连接 扫码连接小红书账号。");
}

async function xhsApiCall(noteUrl: string, params: Record<string, unknown>): Promise<{ message: string; data: XhsNote }> {
  const cookie = await getXhsCookie(params);
  const res = await fetch("http://127.0.0.1:5556/xhs/detail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: noteUrl, download: false, cookie }),
  });
  if (!res.ok) throw new Error(`XHS API HTTP ${res.status}`);
  const json = await res.json() as { message: string; data: XhsNote };
  if (!json.data || Object.keys(json.data).length === 0) {
    // Cookie expired — mark as expired if we have tenant context
    const ctx = params._context as { tenantId?: string } | undefined;
    if (ctx?.tenantId) {
      const { credentialStore } = await import("@/lib/server/credential-store");
      await credentialStore.markExpired(ctx.tenantId, "xhs");
    }
    throw new Error("小红书cookie已过期，请前往 设置 → 连接 重新扫码授权。");
  }
  return json;
}

function parseXhsUrl(url: string): string {
  // Normalize short links and various XHS URL formats to a canonical form
  const n = url.startsWith("http") ? url : `https://${url}`;
  return n;
}

async function xhsInfo(url: string, params: Record<string, unknown>): Promise<VideoInfo> {
  const { data } = await xhsApiCall(parseXhsUrl(url), params);
  const title = data.title ?? data.desc ?? "小红书笔记";
  const uploader = data.user?.nickname ?? data.author?.nickname ?? "未知作者";
  const thumbnail = data.image_list?.[0]?.url_default ?? data.image_list?.[0]?.url ?? "";
  const isVideo = data.type === "video" || !!data.video?.media;
  return {
    title,
    thumbnail,
    duration: 0,
    uploader,
    platform: "xiaohongshu",
    view_count: Number(data.interact_info?.view_count ?? 0),
    formats: isVideo
      ? [{ format_id: "mp4", ext: "mp4", resolution: "unknown", note: "视频笔记" }]
      : data.image_list?.map((_, i) => ({ format_id: `img-${i}`, ext: "jpg", resolution: "original", note: `图片 ${i + 1}` })) ?? [],
  };
}

function xhsPickVideoUrl(data: XhsNote): string {
  const streams = data.video?.media?.stream?.h264 ?? data.video_info_v2?.media?.stream?.h264 ?? [];
  const first = streams[0];
  if (first?.master_url) return first.master_url;
  if (first?.backup_urls?.length) return first.backup_urls[0];
  throw new Error("小红书笔记没有视频内容，或视频流地址无法解析");
}

async function xhsDownloadVideo(url: string, params: Record<string, unknown>): Promise<{ path: string; title: string; duration: number }> {
  const { data } = await xhsApiCall(parseXhsUrl(url), params);
  const title = data.title ?? data.desc ?? "小红书笔记";

  // If video note, download video; otherwise download first image
  if (data.type === "video" || data.video?.media) {
    const videoUrl = xhsPickVideoUrl(data);
    const out = tempFile("mp4");
    await streamToFile(videoUrl, out, {});
    return { path: out, title, duration: 0 };
  }

  const imgUrl = data.image_list?.[0]?.url_default ?? data.image_list?.[0]?.url;
  if (!imgUrl) throw new Error("小红书笔记没有可下载的图片或视频");
  const out = tempFile("jpg");
  await streamToFile(imgUrl, out, {});
  return { path: out, title, duration: 0 };
}

async function xhsDownloadAudio(url: string, params: Record<string, unknown>): Promise<{ path: string; title: string; duration: number }> {
  const { data } = await xhsApiCall(parseXhsUrl(url), params);
  const title = data.title ?? data.desc ?? "小红书笔记";
  const videoUrl = xhsPickVideoUrl(data);
  const vTmp = tempFile("mp4"), out = tempFile("mp3");
  try {
    await streamToFile(videoUrl, vTmp, {});
    const r = await runCommand("ffmpeg", ["-y", "-i", vTmp, "-vn", "-c:a", "libmp3lame", "-q:a", "0", out], 300_000);
    if (r.exitCode !== 0) throw new Error(`ffmpeg失败: ${r.stderr.slice(0, 200)}`);
    return { path: out, title, duration: 0 };
  } finally {
    tryUnlink(vTmp);
  }
}

/* ══════════════════════════════════════════════════════════
   Platform router
   ══════════════════════════════════════════════════════════ */

type Platform = "bilibili" | "douyin" | "youtube" | "xiaohongshu";
const PLATFORMS: Array<{ name: Platform; match: (u: string) => boolean }> = [
  { name: "bilibili", match: (u) => /bilibili\.com|b23\.tv/i.test(u) },
  { name: "douyin", match: (u) => /douyin\.com\/video/i.test(u) },
  { name: "youtube", match: (u) => /youtube\.com|youtu\.be/i.test(u) },
  { name: "xiaohongshu", match: (u) => /xiaohongshu\.com|xhslink\.com|xhs\.link/i.test(u) },
];

function detect(url: string): Platform | null {
  return PLATFORMS.find((p) => p.match(url))?.name ?? null;
}

function fail(code: string, msg: string, start: number) {
  return { status: "failed" as const, error: { code, message: msg }, duration_ms: Date.now() - start };
}

const UNSUPPORTED_MSG = [
  "暂不支持该平台。",
  "✅ 已支持：B站、抖音、YouTube（服务端代理，无需翻墙）、小红书（需扫码授权）",
  "🎵 音乐搜索：试试「搜索歌曲 xxx」使用网易云音乐",
  "❌ 不可用：快手(验证码)、微博(需登录)",
].join("\n");

/* ══════════════════════════════════════════════════════════
   Tool 1: media.video_info
   ══════════════════════════════════════════════════════════ */

const videoInfoManifest: ToolManifest = {
  id: "media.video_info",
  name: "Media Video Info",
  description: "获取视频信息（B站/抖音/YouTube/小红书 — 标题、时长、封面等）",
  category: "video",
  tags: ["video", "info", "bilibili", "douyin", "youtube", "xhs", "抖音", "b站", "油管", "小红书"],
  params: [{ name: "url", type: "string", required: true, description: "视频链接（bilibili / douyin / youtube / xiaohongshu）" }],
  output_type: "json",
  keywords: ["video info", "视频信息", "bilibili", "抖音", "douyin", "youtube", "油管", "小红书", "xhs"],
  patterns: ["(bilibili|b站|douyin|抖音|youtube|油管|小红书|xhs).*info"],
};

type MediaFn<T> = (u: string, p: Record<string, unknown>) => Promise<T>;

const infoFn: Record<Platform, MediaFn<VideoInfo>> = {
  bilibili: (u) => biliInfo(u), douyin: (u) => douyinInfo(u), youtube: (u) => ytInfo(u), xiaohongshu: xhsInfo,
};

const videoInfoHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = params.url as string;
  const p = detect(url);
  if (!p) return fail("unsupported_platform", UNSUPPORTED_MSG, start);
  try {
    const info = await infoFn[p](url, params);
    return { status: "success", output: { ...info, duration_str: formatDuration(info.duration) }, duration_ms: Date.now() - start };
  } catch (err) {
    return fail("media_error", (err as Error).message, start);
  }
};

export const mediaVideoInfo: ToolRegistryEntry = { manifest: videoInfoManifest, handler: videoInfoHandler, timeout: LONG_TIMEOUT_MS };

/* ══════════════════════════════════════════════════════════
   Tool 2: media.download_video
   ══════════════════════════════════════════════════════════ */

const downloadVideoManifest: ToolManifest = {
  id: "media.download_video",
  name: "Media Download Video",
  description: "下载视频MP4（B站480p / 抖音720p / YouTube 720p / 小红书图文或视频）",
  category: "video",
  tags: ["download", "video", "bilibili", "douyin", "youtube", "xhs", "小红书"],
  params: [{ name: "url", type: "string", required: true, description: "视频链接" }],
  output_type: "file",
  keywords: ["下载视频", "download video", "bilibili", "抖音", "douyin", "youtube", "油管", "小红书", "xhs"],
  patterns: ["下载.*(bilibili|b站|douyin|抖音|youtube|油管|视频|小红书|xhs)"],
};

type DlResult = { path: string; title: string; duration: number };

const dlVideoFn: Record<Platform, MediaFn<DlResult>> = {
  bilibili: (u) => biliDownloadVideo(u), douyin: (u) => douyinDownloadVideo(u), youtube: (u) => ytDownloadVideo(u), xiaohongshu: xhsDownloadVideo,
};

const downloadVideoHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = params.url as string;
  const p = detect(url);
  if (!p) return fail("unsupported_platform", UNSUPPORTED_MSG, start);
  try {
    const info = await infoFn[p](url, params);
    const r = await dlVideoFn[p](url, params);
    return {
      status: "success",
      output_url: r.path,
      output: {
        title: r.title,
        duration: r.duration,
        duration_str: formatDuration(r.duration),
        platform: p,
        thumbnail: info.thumbnail,
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return fail("media_error", (err as Error).message, start);
  }
};

export const mediaDownloadVideo: ToolRegistryEntry = { manifest: downloadVideoManifest, handler: downloadVideoHandler, timeout: LONG_TIMEOUT_MS };

/* ══════════════════════════════════════════════════════════
   Tool 3: media.download_audio
   ══════════════════════════════════════════════════════════ */

const downloadAudioManifest: ToolManifest = {
  id: "media.download_audio",
  name: "Media Download Audio",
  description: "从视频提取音频MP3（B站/抖音/YouTube/小红书视频笔记）",
  category: "video",
  tags: ["download", "audio", "mp3", "bilibili", "douyin", "youtube", "xhs", "小红书"],
  params: [{ name: "url", type: "string", required: true, description: "视频链接" }],
  output_type: "file",
  keywords: ["下载音频", "提取音频", "download audio", "youtube", "油管", "小红书", "xhs"],
  patterns: [],
};

const dlAudioFn: Record<Platform, MediaFn<DlResult>> = {
  bilibili: (u) => biliDownloadAudio(u), douyin: (u) => douyinDownloadAudio(u), youtube: (u) => ytDownloadAudio(u), xiaohongshu: xhsDownloadAudio,
};

const downloadAudioHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = params.url as string;
  const p = detect(url);
  if (!p) return fail("unsupported_platform", UNSUPPORTED_MSG, start);
  try {
    const info = await infoFn[p](url, params);
    const r = await dlAudioFn[p](url, params);
    return {
      status: "success",
      output_url: r.path,
      output: {
        title: r.title,
        duration: r.duration,
        duration_str: formatDuration(r.duration),
        format: "mp3",
        platform: p,
        thumbnail: info.thumbnail,
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return fail("media_error", (err as Error).message, start);
  }
};

export const mediaDownloadAudio: ToolRegistryEntry = { manifest: downloadAudioManifest, handler: downloadAudioHandler, timeout: LONG_TIMEOUT_MS };

/* ══════════════════════════════════════════════════════════
   Tool 4: media.extract_subtitle (Bilibili only)
   ══════════════════════════════════════════════════════════ */

const extractSubtitleManifest: ToolManifest = {
  id: "media.extract_subtitle",
  name: "Media Extract Subtitle",
  description: "提取视频字幕SRT（目前仅支持B站有官方字幕的视频）",
  category: "video",
  tags: ["subtitle", "caption", "srt", "字幕", "bilibili"],
  params: [
    { name: "url", type: "string", required: true, description: "B站视频链接" },
    { name: "language", type: "string", required: false, default: "zh-Hans", description: "语言代码" },
  ],
  output_type: "json",
  keywords: ["字幕", "subtitle", "提取字幕"],
  patterns: [],
};

const extractSubtitleHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = params.url as string;
  const lang = (params.language as string) ?? "zh-Hans";
  const p = detect(url);
  if (p !== "bilibili") return fail("not_supported", "字幕提取目前仅支持B站", start);
  try {
    const r = await biliSubtitles(url, lang);
    const srt = r.entries.map((e) => `${e.index}\n${e.start} --> ${e.end}\n${e.text}`).join("\n\n");
    return { status: "success", output: { ...r, total_entries: r.entries.length, srt_text: srt }, duration_ms: Date.now() - start };
  } catch (err) {
    return fail("media_error", (err as Error).message, start);
  }
};

export const mediaExtractSubtitle: ToolRegistryEntry = { manifest: extractSubtitleManifest, handler: extractSubtitleHandler, timeout: LONG_TIMEOUT_MS };
