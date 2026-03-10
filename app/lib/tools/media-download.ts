// @input: Video URLs from Bilibili, Douyin, YouTube, Xiaohongshu
// @output: ToolRegistryEntry objects for 4 media tools (info/video/audio/subtitle)
// @position: Multi-platform media download via public APIs + ffmpeg + server-side proxy

import { createWriteStream, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { getServerEnv } from "@/lib/server/env";
import {
  buildSubtitleTexts,
  normalizeAudioForAsr,
  transcribeWithVolcengine,
} from "./capture-ai";
import { proxyFetch, proxyStreamToFile, tempFile, runCommand } from "./helpers";

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

type SubtitleBundle = {
  title: string;
  platform: string;
  language: string;
  subtitle_source: "official" | "automatic" | "asr";
  txt_text: string;
  srt_text: string;
  vtt_text: string;
  total_entries: number;
  bundle_path: string;
  bundle_file_name: string;
};

const MEDIA_FETCH_TIMEOUT_MS = 30_000;
const MEDIA_SUBTITLE_FETCH_TIMEOUT_MS = 45_000;
const MEDIA_PROXY_ENABLED = Boolean(
  (process.env.MEDIA_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim(),
);

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

function srtToVttTimestamp(value: string): string {
  return value.replace(",", ".");
}

function entriesToSrt(entries: SubtitleEntry[]): string {
  return entries
    .map((entry) => `${entry.index}\n${entry.start} --> ${entry.end}\n${entry.text}`)
    .join("\n\n");
}

function entriesToVtt(entries: SubtitleEntry[]): string {
  const body = entries
    .map(
      (entry) =>
        `${srtToVttTimestamp(entry.start)} --> ${srtToVttTimestamp(entry.end)}\n${entry.text}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

function subtitlePlainText(entries: SubtitleEntry[]): string {
  return entries
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseSrtEntries(source: string): SubtitleEntry[] {
  const blocks = source
    .trim()
    .split(/\r?\n\r?\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
  const entries: SubtitleEntry[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/g).map((line) => line.trim());
    if (lines.length < 2) continue;
    const maybeIndex = Number(lines[0]);
    const timeLineIndex = Number.isFinite(maybeIndex) ? 1 : 0;
    const timeLine = lines[timeLineIndex];
    const text = lines.slice(timeLineIndex + 1).join(" ").trim();
    const match = timeLine.match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})(?:\s+.*)?$/,
    );
    if (!match || !text) continue;
    entries.push({
      index: entries.length + 1,
      start: match[1],
      end: match[2],
      text,
    });
  }
  return entries;
}

function parseVttEntries(source: string): SubtitleEntry[] {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/g);
  const entries: SubtitleEntry[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE")) {
      index += 1;
      continue;
    }
    const timingLine = line.includes("-->") ? line : lines[index + 1]?.trim() || "";
    const textStartIndex = line.includes("-->") ? index + 1 : index + 2;
    const match = timingLine.match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})(?:\s+.*)?$/,
    );
    if (!match) {
      index += 1;
      continue;
    }
    const textLines: string[] = [];
    let cursor = textStartIndex;
    while (cursor < lines.length && lines[cursor].trim()) {
      textLines.push(lines[cursor].trim());
      cursor += 1;
    }
    const text = decodeHtmlEntities(
      textLines.join(" ").replace(/<[^>]+>/g, "").trim(),
    );
    if (text) {
      entries.push({
        index: entries.length + 1,
        start: match[1].replace(".", ","),
        end: match[2].replace(".", ","),
        text,
      });
    }
    index = cursor + 1;
  }
  return entries;
}

function parseSubtitleEntries(text: string, format: string): SubtitleEntry[] {
  if (format === "srt") return parseSrtEntries(text);
  if (format === "vtt") return parseVttEntries(text);
  return [];
}

function pickPreferredLanguage<T>(
  requested: string,
  languages: Array<[string, T]>,
): [string, T] | undefined {
  if (!languages.length) return undefined;
  const raw = requested.trim().toLowerCase();
  const base = raw.split(/[-_]/)[0];
  const scored = languages
    .map(([language, value]) => {
      const normalized = language.toLowerCase();
      let score = 0;
      if (!raw) score = 1;
      else if (normalized === raw) score = 100;
      else if (normalized.startsWith(`${raw}-`) || normalized.startsWith(`${raw}_`))
        score = 90;
      else if (base && (normalized === base || normalized.startsWith(`${base}-`) || normalized.startsWith(`${base}_`)))
        score = 80;
      else if (raw && normalized.includes(raw)) score = 70;
      else if (base && normalized.includes(base)) score = 60;
      return { language, value, score };
    })
    .sort((a, b) => b.score - a.score || a.language.localeCompare(b.language));
  if (scored[0].score <= 0 && raw) return undefined;
  return [scored[0].language, scored[0].value];
}

function sanitizeArtifactBasename(value: string, fallback: string): string {
  const stem = value.replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
  return safe || fallback;
}

function normalizeAsrLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return "zh-CN";
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en-US";
  if (normalized.startsWith("ja")) return "ja-JP";
  if (normalized.startsWith("ko")) return "ko-KR";
  return language;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function createZipBundle(
  baseName: string,
  files: Array<{ name: string; contents: string }>,
): { path: string; fileName: string } {
  const zipName = `${baseName}-subtitles.zip`;
  const zipPath = join(tmpdir(), `omni-media-subtitles-${Date.now()}.zip`);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, "utf8");
    const dataBuffer = Buffer.from(file.contents, "utf8");
    const checksum = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  writeFileSync(zipPath, Buffer.concat([...localParts, centralDirectory, endRecord]));
  return { path: zipPath, fileName: zipName };
}

function buildSubtitleBundle(
  title: string,
  platform: string,
  language: string,
  subtitleSource: "official" | "automatic",
  entries: SubtitleEntry[],
): SubtitleBundle {
  const txtText = subtitlePlainText(entries);
  const srtText = entriesToSrt(entries);
  const vttText = entriesToVtt(entries);
  const baseName = sanitizeArtifactBasename(title, `${platform}-subtitle`);
  const bundle = createZipBundle(baseName, [
    { name: `${baseName}.txt`, contents: txtText },
    { name: `${baseName}.srt`, contents: srtText },
    { name: `${baseName}.vtt`, contents: vttText },
  ]);
  return {
    title,
    platform,
    language,
    subtitle_source: subtitleSource,
    txt_text: txtText,
    srt_text: srtText,
    vtt_text: vttText,
    total_entries: entries.length,
    bundle_path: bundle.path,
    bundle_file_name: bundle.fileName,
  };
}

async function streamToFile(url: string, dest: string, headers: Record<string, string>): Promise<void> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`下载流失败: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
  } catch (error) {
    if (!MEDIA_PROXY_ENABLED || !/^https:\/\//i.test(url)) {
      throw error;
    }
    await proxyStreamToFile(url, dest, headers);
  }
}

async function fetchTextWithOptionalProxy(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<string> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (directError) {
    if (!MEDIA_PROXY_ENABLED) {
      throw directError;
    }
    const proxied = await proxyFetch(url, { headers });
    if (proxied.status >= 400) {
      throw new Error(`HTTP ${proxied.status}`);
    }
    return proxied.body;
  }
}

/* ══════════════════════════════════════════════════════════
   Bilibili — Public API (no login: max 480p DASH)
   ══════════════════════════════════════════════════════════ */

const BILI_H = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer": "https://www.bilibili.com",
};

async function biliGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: BILI_H,
    signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Bilibili API ${res.status}`);
  const json = await res.json() as Record<string, unknown>;
  if (json.code !== 0) throw new Error(`Bilibili ${json.code}: ${json.message}`);
  return json.data as Record<string, unknown>;
}

async function parseBvid(url: string): Promise<string> {
  const n = url.startsWith("http") ? url : `https://${url}`;
  if (n.includes("b23.tv")) {
    const res = await fetch(n, {
      headers: BILI_H,
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    });
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
  const res = await fetch(`https:${picked.subtitle_url}`, {
    headers: BILI_H,
    signal: AbortSignal.timeout(MEDIA_SUBTITLE_FETCH_TIMEOUT_MS),
  });
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
  args.push("--socket-timeout", "15");
  args.push("--extractor-retries", "1");
  args.push("--retries", "1");
  args.push("--fragment-retries", "1");
  if (existsSync(YT_COOKIES_PATH)) args.push("--cookies", YT_COOKIES_PATH);
  return args;
}

function ytSubtitleArgs(): string[] {
  return [
    ...ytBaseArgs(),
    "--ignore-no-formats-error",
    "--no-js-runtimes",
    "--extractor-args",
    "youtube:player_client=ios;player_skip=webpage",
  ];
}

function ytAudioArgs(): string[] {
  return [
    ...ytBaseArgs(),
    "--extractor-args",
    "youtube:player_client=android;player_skip=webpage",
  ];
}

function throwYtError(stderr: string): never {
  if (stderr.includes("Sign in") || stderr.includes("bot")) throw new Error(YT_AUTH_MSG);
  if (stderr.includes("ENOENT")) throw new Error("yt-dlp未安装。请运行: pip install yt-dlp");
  throw new Error(`YouTube错误: ${stderr.slice(0, 300)}`);
}

type YtSubtitleTrack = {
  ext?: string;
  url?: string;
  name?: string;
};

type YtDlpMeta = {
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  channel?: string;
  view_count?: number;
  formats?: Array<{ format_id: string; ext: string; vcodec: string; height?: number; width?: number; resolution?: string; format_note?: string }>;
  subtitles?: Record<string, YtSubtitleTrack[]>;
  automatic_captions?: Record<string, YtSubtitleTrack[]>;
};

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
  ], 180_000);
  if (dlR.exitCode !== 0) { tryUnlink(out); throwYtError(dlR.stderr); }
  return { path: out, title: d.title ?? "YouTube Video", duration: d.duration ?? 0 };
}

async function ytDownloadAudio(url: string): Promise<{ path: string; title: string; duration: number }> {
  const infoR = await runCommand("yt-dlp", [...ytAudioArgs(), "-j", url], 60_000);
  if (infoR.exitCode !== 0) throwYtError(infoR.stderr);
  const d = JSON.parse(infoR.stdout) as YtDlpMeta;
  const out = tempFile("mp3");
  const dlR = await runCommand("yt-dlp", [
    ...ytAudioArgs(), "-x", "--audio-format", "mp3", "--audio-quality", "0",
    "--no-part", "-o", out, url,
  ], 180_000);
  if (dlR.exitCode !== 0) { tryUnlink(out); throwYtError(dlR.stderr); }
  return { path: out, title: d.title ?? "YouTube Video", duration: d.duration ?? 0 };
}

async function ytDownloadAudioFast(url: string): Promise<{ path: string; title: string; duration: number }> {
  const out = tempFile("mp3");
  const dlR = await runCommand(
    "yt-dlp",
    [
      ...ytAudioArgs(),
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--no-part",
      "-o",
      out,
      url,
    ],
    45_000,
  );
  if (dlR.exitCode !== 0) {
    tryUnlink(out);
    throwYtError(dlR.stderr);
  }
  return {
    path: out,
    title: `youtube-${parseYtId(url)}`,
    duration: 0,
  };
}

async function ytSubtitles(url: string, lang: string): Promise<SubtitleBundle> {
  const infoR = await runCommand(
    "yt-dlp",
    [...ytSubtitleArgs(), "--skip-download", "-J", url],
    20_000,
  );
  if (infoR.exitCode !== 0) throwYtError(infoR.stderr);
  const data = JSON.parse(infoR.stdout) as YtDlpMeta;
  const manual = Object.entries(data.subtitles ?? {});
  const automatic = Object.entries(data.automatic_captions ?? {});
  const manualPick = pickPreferredLanguage(lang, manual);
  const automaticPick = pickPreferredLanguage(lang, automatic);
  const picked = manualPick ?? automaticPick;
  if (!picked) {
    throw new Error("This YouTube video does not expose usable subtitles.");
  }

  const subtitleSource: "official" | "automatic" = manualPick ? "official" : "automatic";
  const [language, tracks] = picked;
  const trackList = Array.isArray(tracks) ? tracks : [];
  const vttTrack =
    trackList.find((track) => track?.ext === "vtt" && typeof track.url === "string");
  const srtTrack =
    trackList.find((track) => track?.ext === "srt" && typeof track.url === "string") ??
    vttTrack;
  if (!vttTrack && !srtTrack) {
    throw new Error("YouTube subtitles were listed but no downloadable subtitle track was available.");
  }

  const [vttTextRaw, srtTextRaw] = await Promise.all([
    vttTrack?.url
      ? fetchTextWithOptionalProxy(vttTrack.url, MEDIA_SUBTITLE_FETCH_TIMEOUT_MS)
      : Promise.resolve(""),
    srtTrack?.url
      ? fetchTextWithOptionalProxy(srtTrack.url, MEDIA_SUBTITLE_FETCH_TIMEOUT_MS)
      : Promise.resolve(""),
  ]);

  const vttEntries =
    parseSubtitleEntries(vttTextRaw, vttTrack?.ext === "srt" ? "srt" : "vtt");
  const srtEntries =
    parseSubtitleEntries(srtTextRaw, srtTrack?.ext === "vtt" ? "vtt" : "srt");
  const entries =
    vttEntries.length > 0 ? vttEntries : srtEntries.length > 0 ? srtEntries : [];
  if (!entries.length) {
    throw new Error("YouTube subtitle tracks were fetched, but no subtitle entries could be parsed.");
  }
  return buildSubtitleBundle(
    data.title ?? "YouTube Video",
    "youtube",
    language,
    subtitleSource,
    entries,
  );
}

const DIRECT_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
];

function looksLikeDirectVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return DIRECT_VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function directVideoExt(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const matched = DIRECT_VIDEO_EXTENSIONS.find((ext) => pathname.endsWith(ext));
    return matched ? matched.slice(1) : "mp4";
  } catch {
    return "mp4";
  }
}

function directVideoTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() || "remote-video";
    return decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, "")) || "remote-video";
  } catch {
    return "remote-video";
  }
}

async function directInfo(url: string): Promise<VideoInfo> {
  const ext = directVideoExt(url);
  return {
    title: directVideoTitle(url),
    thumbnail: "",
    duration: 0,
    uploader: new URL(url).hostname,
    platform: "direct",
    view_count: 0,
    formats: [
      {
        format_id: "direct-file",
        ext,
        resolution: "unknown",
        note: "Direct downloadable video URL",
      },
    ],
  };
}

async function directDownloadVideo(url: string): Promise<{ path: string; title: string; duration: number }> {
  const ext = directVideoExt(url);
  const out = tempFile(ext);
  await streamToFile(url, out, {});
  return {
    path: out,
    title: directVideoTitle(url),
    duration: 0,
  };
}

async function directDownloadAudio(url: string): Promise<{ path: string; title: string; duration: number }> {
  const video = await directDownloadVideo(url);
  const out = tempFile("mp3");
  try {
    const r = await runCommand(
      "ffmpeg",
      ["-y", "-i", video.path, "-vn", "-c:a", "libmp3lame", "-q:a", "0", out],
      300_000,
    );
    if (r.exitCode !== 0) {
      throw new Error(`ffmpeg失败: ${r.stderr.slice(0, 200)}`);
    }
    return {
      path: out,
      title: video.title,
      duration: video.duration,
    };
  } finally {
    tryUnlink(video.path);
  }
}

async function transcribeSubtitleFallback(
  platform: "bilibili" | "youtube" | "douyin" | "xiaohongshu" | "direct",
  language: string,
  downloadAudio: () => Promise<{ path: string; title: string; duration: number }>,
): Promise<SubtitleBundle> {
  const audio = await downloadAudio();
  let normalizedAudioPath: string | undefined;
  try {
    normalizedAudioPath = await normalizeAudioForAsr(audio.path);
    const transcription = await transcribeWithVolcengine(
      normalizedAudioPath,
      normalizeAsrLanguage(language),
    );
    const transcript = transcription.text.trim();
    const subtitles = buildSubtitleTexts(
      transcript,
      transcription.utterances,
      transcription.durationMs || Math.max(0, audio.duration) * 1000,
    );
    const baseName = sanitizeArtifactBasename(
      audio.title,
      `${platform}-subtitle`,
    );
    const bundle = createZipBundle(baseName, [
      { name: `${baseName}.txt`, contents: subtitles.txtText },
      { name: `${baseName}.srt`, contents: subtitles.srtText },
      { name: `${baseName}.vtt`, contents: subtitles.vttText },
    ]);
    return {
      title: audio.title,
      platform,
      language,
      subtitle_source: "asr",
      txt_text: subtitles.txtText,
      srt_text: subtitles.srtText,
      vtt_text: subtitles.vttText,
      total_entries: subtitles.segments.length,
      bundle_path: bundle.path,
      bundle_file_name: bundle.fileName,
    };
  } finally {
    if (normalizedAudioPath) {
      tryUnlink(audio.path, normalizedAudioPath);
    } else {
      tryUnlink(audio.path);
    }
  }
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
  const env = getServerEnv();
  if (env.xhsCookie) return env.xhsCookie;
  throw new Error(
    "xhs_auth_required: Xiaohongshu subtitle extraction requires an active tenant connection or OMNIAGENT_XHS_COOKIE in the deployment environment.",
  );
}

async function xhsApiCall(noteUrl: string, params: Record<string, unknown>): Promise<{ message: string; data: XhsNote }> {
  const cookie = await getXhsCookie(params);
  const env = getServerEnv();
  let res: Response;
  try {
    res = await fetch(`${env.xhsBridgeUrl}/xhs/detail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: noteUrl, download: false, cookie }),
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new Error(
      `xhs_bridge_unavailable: Xiaohongshu bridge is unavailable at ${env.xhsBridgeUrl}. Start the bridge service or configure OMNIAGENT_XHS_BRIDGE_URL for this deployment.`,
    );
  }
  if (!res.ok) throw new Error(`XHS API HTTP ${res.status}`);
  const json = await res.json() as { message: string; data: XhsNote };
  if (!json.data || Object.keys(json.data).length === 0) {
    // Cookie expired — mark as expired if we have tenant context
    const ctx = params._context as { tenantId?: string } | undefined;
    if (ctx?.tenantId) {
      const { credentialStore } = await import("@/lib/server/credential-store");
      await credentialStore.markExpired(ctx.tenantId, "xhs");
    }
    throw new Error(
      "xhs_auth_required: Xiaohongshu credential is expired. Reconnect the tenant account or refresh OMNIAGENT_XHS_COOKIE for this deployment.",
    );
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

type Platform = "bilibili" | "douyin" | "youtube" | "xiaohongshu" | "direct";
const PLATFORMS: Array<{ name: Platform; match: (u: string) => boolean }> = [
  { name: "bilibili", match: (u) => /bilibili\.com|b23\.tv/i.test(u) },
  { name: "douyin", match: (u) => /douyin\.com\/video|iesdouyin\.com\/share\/video|v\.douyin\.com/i.test(u) },
  { name: "youtube", match: (u) => /youtube\.com|youtu\.be/i.test(u) },
  { name: "xiaohongshu", match: (u) => /xiaohongshu\.com|xhslink\.com|xhs\.link/i.test(u) },
  { name: "direct", match: (u) => looksLikeDirectVideoUrl(u) },
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
  description: "获取视频信息（B站/抖音/YouTube/小红书/直链视频 — 标题、时长、封面等）",
  category: "video",
  tags: ["video", "info", "bilibili", "douyin", "youtube", "xhs", "direct", "抖音", "b站", "油管", "小红书"],
  params: [{ name: "url", type: "string", required: true, description: "视频链接（bilibili / douyin / youtube / xiaohongshu / direct media url）" }],
  output_type: "json",
  keywords: ["video info", "视频信息", "bilibili", "抖音", "douyin", "youtube", "油管", "小红书", "xhs", "video url"],
  patterns: ["(bilibili|b站|douyin|抖音|youtube|油管|小红书|xhs|video url).*info"],
};

type MediaFn<T> = (u: string, p: Record<string, unknown>) => Promise<T>;

const infoFn: Record<Platform, MediaFn<VideoInfo>> = {
  bilibili: (u) => biliInfo(u),
  douyin: (u) => douyinInfo(u),
  youtube: (u) => ytInfo(u),
  xiaohongshu: xhsInfo,
  direct: (u) => directInfo(u),
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
  description: "下载视频MP4（B站480p / 抖音720p / YouTube 720p / 小红书图文或视频 / 直链视频）",
  category: "video",
  tags: ["download", "video", "bilibili", "douyin", "youtube", "xhs", "direct", "小红书"],
  params: [{ name: "url", type: "string", required: true, description: "视频链接" }],
  output_type: "file",
  keywords: ["下载视频", "download video", "bilibili", "抖音", "douyin", "youtube", "油管", "小红书", "xhs", "video url"],
  patterns: ["下载.*(bilibili|b站|douyin|抖音|youtube|油管|视频|小红书|xhs|video url)"],
};

type DlResult = { path: string; title: string; duration: number };

const dlVideoFn: Record<Platform, MediaFn<DlResult>> = {
  bilibili: (u) => biliDownloadVideo(u),
  douyin: (u) => douyinDownloadVideo(u),
  youtube: (u) => ytDownloadVideo(u),
  xiaohongshu: xhsDownloadVideo,
  direct: (u) => directDownloadVideo(u),
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
  description: "从视频提取音频MP3（B站/抖音/YouTube/小红书视频笔记/直链视频）",
  category: "video",
  tags: ["download", "audio", "mp3", "bilibili", "douyin", "youtube", "xhs", "direct", "小红书"],
  params: [{ name: "url", type: "string", required: true, description: "视频链接" }],
  output_type: "file",
  keywords: ["下载音频", "提取音频", "download audio", "youtube", "油管", "小红书", "xhs", "video url"],
  patterns: [],
};

const dlAudioFn: Record<Platform, MediaFn<DlResult>> = {
  bilibili: (u) => biliDownloadAudio(u),
  douyin: (u) => douyinDownloadAudio(u),
  youtube: (u) => ytDownloadAudio(u),
  xiaohongshu: xhsDownloadAudio,
  direct: (u) => directDownloadAudio(u),
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
  description: "Extract subtitles from supported media links with a unified TXT/SRT/VTT result contract.",
  category: "video",
  tags: ["subtitle", "caption", "srt", "vtt", "字幕", "bilibili", "youtube"],
  params: [
    { name: "url", type: "string", required: true, description: "Supported media URL" },
    { name: "language", type: "string", required: false, default: "zh-Hans", description: "Preferred subtitle language code" },
  ],
  output_type: "json",
  keywords: ["字幕", "subtitle", "caption", "提取字幕", "youtube subtitle", "bilibili subtitle"],
  patterns: [],
};

const extractSubtitleHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = params.url as string;
  const lang = (params.language as string) ?? "zh-Hans";
  const p = detect(url);
  if (!p) {
    return fail(
      "not_supported",
      "Subtitle extraction supports Bilibili, YouTube, Douyin, Xiaohongshu, and direct downloadable video URLs.",
      start,
    );
  }
  try {
    let result: SubtitleBundle;
    if (p === "bilibili") {
      try {
        const r = await biliSubtitles(url, lang);
        result = buildSubtitleBundle(
          r.title,
          "bilibili",
          r.language,
          "official",
          r.entries,
        );
      } catch {
        result = await transcribeSubtitleFallback("bilibili", lang, () =>
          biliDownloadAudio(url),
        );
      }
    } else if (p === "youtube") {
      try {
        result = await ytSubtitles(url, lang);
      } catch {
        result = await transcribeSubtitleFallback("youtube", lang, () =>
          ytDownloadAudioFast(url),
        );
      }
    } else if (p === "douyin") {
      result = await transcribeSubtitleFallback("douyin", lang, () =>
        douyinDownloadAudio(url),
      );
    } else if (p === "xiaohongshu") {
      result = await transcribeSubtitleFallback("xiaohongshu", lang, () =>
        xhsDownloadAudio(url, params),
      );
    } else {
      result = await transcribeSubtitleFallback("direct", lang, () =>
        directDownloadAudio(url),
      );
    }
    return {
      status: "success",
      output_url: result.bundle_path,
      output: {
        title: result.title,
        platform: result.platform,
        language: result.language,
        subtitle_source: result.subtitle_source,
        txt_text: result.txt_text,
        srt_text: result.srt_text,
        vtt_text: result.vtt_text,
        total_entries: result.total_entries,
        subtitle_bundle_file_name: result.bundle_file_name,
      },
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return fail("media_error", (err as Error).message, start);
  }
};

export const mediaExtractSubtitle: ToolRegistryEntry = { manifest: extractSubtitleManifest, handler: extractSubtitleHandler, timeout: LONG_TIMEOUT_MS };
