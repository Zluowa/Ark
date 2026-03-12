// @input: Video URLs from Bilibili, Douyin, YouTube, Xiaohongshu
// @output: ToolRegistryEntry objects for 4 media tools (info/video/audio/subtitle)
// @position: Multi-platform media download via public APIs + ffmpeg + server-side proxy

import {
  createWriteStream,
  existsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ToolHandler,
  ToolManifest,
  ToolRegistryEntry,
} from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { getServerEnv } from "@/lib/server/env";
import {
  getMediaProviderConfig,
  type MediaOperation,
  type MediaProviderName,
  type VidBeeRuntimeSettings,
} from "@/lib/server/media-provider-config";
import {
  VidBeeClient,
  type VidBeeVideoFormat,
  type VidBeeVideoInfo,
} from "@/lib/server/vidbee-client";
import {
  buildSubtitleTexts,
  normalizeAudioForAsr,
  transcribeWithVolcengine,
} from "./capture-ai";
import { proxyFetch, proxyStreamToFile, tempFile, runCommand } from "./helpers";

/* 鈹€鈹€ Shared types 鈹€鈹€ */

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  platform: string;
  view_count: number;
  formats: Array<{
    format_id: string;
    ext: string;
    resolution: string;
    note: string;
    filesize_approx?: number;
  }>;
  subtitles_available?: Array<{ lan: string; lan_doc: string }>;
}

interface SubtitleEntry {
  index: number;
  start: string;
  end: string;
  text: string;
}

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
  (
    process.env.MEDIA_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ""
  ).trim(),
);

/* 鈹€鈹€ Shared utilities 鈹€鈹€ */

function tryUnlink(...paths: string[]): void {
  for (const p of paths)
    try {
      unlinkSync(p);
    } catch {
      /* ok */
    }
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
    .map(
      (entry) =>
        `${entry.index}\n${entry.start} --> ${entry.end}\n${entry.text}`,
    )
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
    const text = lines
      .slice(timeLineIndex + 1)
      .join(" ")
      .trim();
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
    const timingLine = line.includes("-->")
      ? line
      : lines[index + 1]?.trim() || "";
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
      textLines
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .trim(),
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
      else if (
        normalized.startsWith(`${raw}-`) ||
        normalized.startsWith(`${raw}_`)
      )
        score = 90;
      else if (
        base &&
        (normalized === base ||
          normalized.startsWith(`${base}-`) ||
          normalized.startsWith(`${base}_`))
      )
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
  const withoutReserved = stem.replace(/[<>:"/\\|?*]+/g, "-");
  const safe = Array.from(withoutReserved, (char) =>
    char.charCodeAt(0) < 32 ? "-" : char,
  )
    .join("")
    .trim();
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

  writeFileSync(
    zipPath,
    Buffer.concat([...localParts, centralDirectory, endRecord]),
  );
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

async function streamToFile(
  url: string,
  dest: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`涓嬭浇娴佸け璐? ${res.status}`);
    await pipeline(
      Readable.fromWeb(res.body as never),
      createWriteStream(dest),
    );
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

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Bilibili 鈥?Public API (no login: max 480p DASH)
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

const BILI_H = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Referer: "https://www.bilibili.com",
};

async function biliGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: BILI_H,
    signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Bilibili API ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json.code !== 0)
    throw new Error(`Bilibili ${json.code}: ${json.message}`);
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
  throw new Error(
    "鏃犳硶璇嗗埆鐨凚绔欓摼鎺ワ紝璇锋彁渚?bilibili.com/video/BVxxx 鏍煎紡",
  );
}

async function biliInfo(url: string): Promise<VideoInfo> {
  const bvid = await parseBvid(url);
  const d = await biliGet(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );
  const owner = d.owner as Record<string, unknown>;
  const stat = d.stat as Record<string, unknown>;

  const subData = await biliGet(
    `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${(d.pages as Array<Record<string, unknown>>)[0].cid}`,
  );
  const subs = ((subData.subtitle as Record<string, unknown>)?.subtitles ??
    []) as Array<Record<string, unknown>>;

  return {
    title: d.title as string,
    thumbnail: d.pic as string,
    duration: d.duration as number,
    uploader: owner.name as string,
    platform: "bilibili",
    view_count: stat.view as number,
    formats: [
      {
        format_id: "dash-480p",
        ext: "mp4",
        resolution: "854x480",
        note: "鏃犵櫥褰曟渶楂?80p",
      },
    ],
    subtitles_available: subs.map((s) => ({
      lan: s.lan as string,
      lan_doc: s.lan_doc as string,
    })),
  };
}

async function biliDownloadVideo(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const bvid = await parseBvid(url);
  const d = await biliGet(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );
  const cid = (d.pages as Array<Record<string, unknown>>)[0].cid as number;
  const play = await biliGet(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=16`,
  );
  const dash = play.dash as Record<string, unknown>;
  const videos = dash.video as Array<Record<string, unknown>>;
  const audios = dash.audio as Array<Record<string, unknown>>;
  if (!videos?.length || !audios?.length)
    throw new Error("Unable to retrieve Bilibili video streams.");

  const vTmp = tempFile("m4s"),
    aTmp = tempFile("m4s"),
    out = tempFile("mp4");
  try {
    await Promise.all([
      streamToFile(videos[0].baseUrl as string, vTmp, BILI_H),
      streamToFile(audios[0].baseUrl as string, aTmp, BILI_H),
    ]);
    const r = await runCommand(
      "ffmpeg",
      ["-y", "-i", vTmp, "-i", aTmp, "-c", "copy", out],
      300_000,
    );
    if (r.exitCode !== 0)
      throw new Error(`ffmpeg鍚堝苟澶辫触: ${r.stderr.slice(0, 200)}`);
    return {
      path: out,
      title: d.title as string,
      duration: d.duration as number,
    };
  } finally {
    tryUnlink(vTmp, aTmp);
  }
}

async function biliDownloadAudio(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const bvid = await parseBvid(url);
  const d = await biliGet(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );
  const cid = (d.pages as Array<Record<string, unknown>>)[0].cid as number;
  const play = await biliGet(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=16`,
  );
  const audios = (play.dash as Record<string, unknown>).audio as Array<
    Record<string, unknown>
  >;
  if (!audios?.length)
    throw new Error("Unable to retrieve Bilibili audio stream.");

  const aTmp = tempFile("m4s"),
    out = tempFile("mp3");
  try {
    await streamToFile(audios[0].baseUrl as string, aTmp, BILI_H);
    const r = await runCommand(
      "ffmpeg",
      ["-y", "-i", aTmp, "-c:a", "libmp3lame", "-q:a", "0", out],
      300_000,
    );
    if (r.exitCode !== 0)
      throw new Error(`ffmpeg澶辫触: ${r.stderr.slice(0, 200)}`);
    return {
      path: out,
      title: d.title as string,
      duration: d.duration as number,
    };
  } finally {
    tryUnlink(aTmp);
  }
}

async function biliSubtitles(
  url: string,
  lang: string,
): Promise<{ title: string; language: string; entries: SubtitleEntry[] }> {
  const bvid = await parseBvid(url);
  const d = await biliGet(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
  );
  const cid = (d.pages as Array<Record<string, unknown>>)[0].cid as number;
  const sub = await biliGet(
    `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`,
  );
  const subs = ((sub.subtitle as Record<string, unknown>)?.subtitles ??
    []) as Array<Record<string, unknown>>;
  if (!subs.length)
    throw new Error(
      "No official subtitles are available for this Bilibili video.",
    );

  const picked =
    subs.find((s) => (s.lan as string).startsWith(lang)) ?? subs[0];
  const res = await fetch(`https:${picked.subtitle_url}`, {
    headers: BILI_H,
    signal: AbortSignal.timeout(MEDIA_SUBTITLE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Failed to download subtitles: ${res.status}`);
  const raw = (await res.json()) as {
    body: Array<{ from: number; to: number; content: string }>;
  };

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

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Douyin 鈥?iesdouyin SSR share page (720p, watermark)
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

const DY_H = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
};

function parseDouyinId(url: string): string {
  const n = url.startsWith("http") ? url : `https://${url}`;
  const m = n.match(/video\/(\d+)/);
  if (m) return m[1];
  throw new Error("Unable to parse the Douyin URL. Use douyin.com/video/{ID}.");
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
  const res = await fetch(`https://www.iesdouyin.com/share/video/${awemeId}/`, {
    headers: DY_H,
  });
  if (!res.ok) throw new Error(`Douyin page request failed: ${res.status}`);
  const html = await res.text();
  const match = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Unable to parse the Douyin page payload.");
  const data = JSON.parse(match[1].trim());
  const page = data.loaderData?.["video_(id)/page"];
  const items = page?.videoInfoRes?.item_list as DouyinItem[] | undefined;
  if (!items?.length) {
    const filter = page?.videoInfoRes?.filter_list;
    const reason = filter?.[0]?.filter_reason ?? "鏈煡鍘熷洜";
    throw new Error(`Douyin video is not available: ${reason}`);
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
    formats: [
      {
        format_id: "mp4-720p",
        ext: "mp4",
        resolution: `${item.video.width}x${item.video.height}`,
        note: "720p watermarked",
      },
    ],
  };
}

async function douyinDownloadVideo(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const item = await douyinFetchItem(parseDouyinId(url));
  const videoUrl = item.video.play_addr.url_list[0];
  if (!videoUrl) throw new Error("鏃犳硶鑾峰彇鎶栭煶瑙嗛涓嬭浇鍦板潃");
  const out = tempFile("mp4");
  await streamToFile(videoUrl, out, DY_H);
  return {
    path: out,
    title: item.desc,
    duration: Math.round(item.video.duration / 1000),
  };
}

async function douyinDownloadAudio(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const item = await douyinFetchItem(parseDouyinId(url));
  const videoUrl = item.video.play_addr.url_list[0];
  if (!videoUrl) throw new Error("鏃犳硶鑾峰彇鎶栭煶瑙嗛涓嬭浇鍦板潃");
  const vTmp = tempFile("mp4"),
    out = tempFile("mp3");
  try {
    await streamToFile(videoUrl, vTmp, DY_H);
    const r = await runCommand(
      "ffmpeg",
      ["-y", "-i", vTmp, "-vn", "-c:a", "libmp3lame", "-q:a", "0", out],
      300_000,
    );
    if (r.exitCode !== 0)
      throw new Error(`ffmpeg澶辫触: ${r.stderr.slice(0, 200)}`);
    return {
      path: out,
      title: item.desc,
      duration: Math.round(item.video.duration / 1000),
    };
  } finally {
    tryUnlink(vTmp);
  }
}

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   YouTube 鈥?yt-dlp + 鏈嶅姟绔唬鐞?+ cookie璁よ瘉
   闇€瑕? yt-dlp + ffmpeg, MEDIA_PROXY/HTTPS_PROXY 閰嶇疆浠ｇ悊
   璁よ瘉: .omniagent-state/youtube-cookies.txt (涓€娆℃€ц缃?
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

const YT_COOKIES_PATH = `${process.env.OMNIAGENT_LOCAL_STATE_DIR?.trim() || `${process.cwd()}/.omniagent-state`}/youtube-cookies.txt`;
const YT_AUTH_MSG =
  "YouTube闇€瑕佺櫥褰曡璇併€傝鍓嶅線 璁剧疆 鈫?杩炴帴 鎺堟潈YouTube璐﹀彿锛屾垨杩愯: node scripts/youtube-setup.mjs";

function parseYtId(url: string): string {
  const m = url.match(
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m) return m[1];
  throw new Error("鏃犳硶璇嗗埆鐨刌ouTube閾炬帴");
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
  if (stderr.includes("Sign in") || stderr.includes("bot"))
    throw new Error(YT_AUTH_MSG);
  if (stderr.includes("ENOENT"))
    throw new Error("yt-dlp鏈畨瑁呫€傝杩愯: pip install yt-dlp");
  throw new Error(`YouTube閿欒: ${stderr.slice(0, 300)}`);
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
  formats?: Array<{
    format_id: string;
    ext: string;
    vcodec: string;
    height?: number;
    width?: number;
    resolution?: string;
    format_note?: string;
  }>;
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
    .map((f) => ({
      format_id: String(f.format_id),
      ext: "mp4",
      resolution: f.resolution ?? `${f.width}x${f.height}`,
      note: `${f.format_note ?? ""} server-side proxy download`.trim(),
    }))
    .filter((f) => {
      if (seen.has(f.resolution)) return false;
      seen.add(f.resolution);
      return true;
    });
  return {
    title: d.title ?? "",
    thumbnail: d.thumbnail ?? "",
    duration: d.duration ?? 0,
    uploader: d.uploader ?? d.channel ?? "",
    platform: "youtube",
    view_count: d.view_count ?? 0,
    formats: fmts,
  };
}

async function ytDownloadVideo(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const infoR = await runCommand(
    "yt-dlp",
    [...ytBaseArgs(), "-j", url],
    60_000,
  );
  if (infoR.exitCode !== 0) throwYtError(infoR.stderr);
  const d = JSON.parse(infoR.stdout) as YtDlpMeta;
  const out = tempFile("mp4");
  const dlR = await runCommand(
    "yt-dlp",
    [
      ...ytBaseArgs(),
      "-f",
      "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best",
      "--merge-output-format",
      "mp4",
      "--no-part",
      "-o",
      out,
      url,
    ],
    180_000,
  );
  if (dlR.exitCode !== 0) {
    tryUnlink(out);
    throwYtError(dlR.stderr);
  }
  return {
    path: out,
    title: d.title ?? "YouTube Video",
    duration: d.duration ?? 0,
  };
}

async function ytDownloadAudio(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const infoR = await runCommand(
    "yt-dlp",
    [...ytAudioArgs(), "-j", url],
    60_000,
  );
  if (infoR.exitCode !== 0) throwYtError(infoR.stderr);
  const d = JSON.parse(infoR.stdout) as YtDlpMeta;
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
    180_000,
  );
  if (dlR.exitCode !== 0) {
    tryUnlink(out);
    throwYtError(dlR.stderr);
  }
  return {
    path: out,
    title: d.title ?? "YouTube Video",
    duration: d.duration ?? 0,
  };
}

async function ytDownloadAudioFast(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
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

  const subtitleSource: "official" | "automatic" = manualPick
    ? "official"
    : "automatic";
  const [language, tracks] = picked;
  const trackList = Array.isArray(tracks) ? tracks : [];
  const vttTrack = trackList.find(
    (track) => track?.ext === "vtt" && typeof track.url === "string",
  );
  const srtTrack =
    trackList.find(
      (track) => track?.ext === "srt" && typeof track.url === "string",
    ) ?? vttTrack;
  if (!vttTrack && !srtTrack) {
    throw new Error(
      "YouTube subtitles were listed but no downloadable subtitle track was available.",
    );
  }

  const [vttTextRaw, srtTextRaw] = await Promise.all([
    vttTrack?.url
      ? fetchTextWithOptionalProxy(
          vttTrack.url,
          MEDIA_SUBTITLE_FETCH_TIMEOUT_MS,
        )
      : Promise.resolve(""),
    srtTrack?.url
      ? fetchTextWithOptionalProxy(
          srtTrack.url,
          MEDIA_SUBTITLE_FETCH_TIMEOUT_MS,
        )
      : Promise.resolve(""),
  ]);

  const vttEntries = parseSubtitleEntries(
    vttTextRaw,
    vttTrack?.ext === "srt" ? "srt" : "vtt",
  );
  const srtEntries = parseSubtitleEntries(
    srtTextRaw,
    srtTrack?.ext === "vtt" ? "vtt" : "srt",
  );
  const entries =
    vttEntries.length > 0
      ? vttEntries
      : srtEntries.length > 0
        ? srtEntries
        : [];
  if (!entries.length) {
    throw new Error(
      "YouTube subtitle tracks were fetched, but no subtitle entries could be parsed.",
    );
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
    const matched = DIRECT_VIDEO_EXTENSIONS.find((ext) =>
      pathname.endsWith(ext),
    );
    return matched ? matched.slice(1) : "mp4";
  } catch {
    return "mp4";
  }
}

function directVideoTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const last =
      parsed.pathname.split("/").filter(Boolean).pop() || "remote-video";
    return (
      decodeURIComponent(last.replace(/\.[a-z0-9]+$/i, "")) || "remote-video"
    );
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

async function directDownloadVideo(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const ext = directVideoExt(url);
  const out = tempFile(ext);
  await streamToFile(url, out, {});
  return {
    path: out,
    title: directVideoTitle(url),
    duration: 0,
  };
}

async function directDownloadAudio(
  url: string,
): Promise<{ path: string; title: string; duration: number }> {
  const video = await directDownloadVideo(url);
  const out = tempFile("mp3");
  try {
    const r = await runCommand(
      "ffmpeg",
      ["-y", "-i", video.path, "-vn", "-c:a", "libmp3lame", "-q:a", "0", out],
      300_000,
    );
    if (r.exitCode !== 0) {
      throw new Error(`ffmpeg澶辫触: ${r.stderr.slice(0, 200)}`);
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
  downloadAudio: () => Promise<{
    path: string;
    title: string;
    duration: number;
  }>,
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

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Xiaohongshu 鈥?via XHS-Downloader Docker API (port 5556)
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

type XhsNote = {
  title?: string;
  desc?: string;
  user?: { nickname?: string };
  author?: { nickname?: string };
  image_list?: Array<{ url?: string; url_default?: string }>;
  video?: {
    media?: {
      stream?: {
        h264?: Array<{ master_url?: string; backup_urls?: string[] }>;
      };
    };
  };
  video_info_v2?: {
    media?: {
      stream?: {
        h264?: Array<{ master_url?: string; backup_urls?: string[] }>;
      };
    };
  };
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

async function xhsApiCall(
  noteUrl: string,
  params: Record<string, unknown>,
): Promise<{ message: string; data: XhsNote }> {
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
  const json = (await res.json()) as { message: string; data: XhsNote };
  if (!json.data || Object.keys(json.data).length === 0) {
    // Cookie expired 鈥?mark as expired if we have tenant context
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

async function xhsInfo(
  url: string,
  params: Record<string, unknown>,
): Promise<VideoInfo> {
  const { data } = await xhsApiCall(parseXhsUrl(url), params);
  const title = data.title ?? data.desc ?? "Xiaohongshu note";
  const uploader =
    data.user?.nickname ?? data.author?.nickname ?? "Unknown creator";
  const thumbnail =
    data.image_list?.[0]?.url_default ?? data.image_list?.[0]?.url ?? "";
  const isVideo = data.type === "video" || !!data.video?.media;
  return {
    title,
    thumbnail,
    duration: 0,
    uploader,
    platform: "xiaohongshu",
    view_count: Number(data.interact_info?.view_count ?? 0),
    formats: isVideo
      ? [
          {
            format_id: "mp4",
            ext: "mp4",
            resolution: "unknown",
            note: "瑙嗛绗旇",
          },
        ]
      : (data.image_list?.map((_, i) => ({
          format_id: `img-${i}`,
          ext: "jpg",
          resolution: "original",
          note: `鍥剧墖 ${i + 1}`,
        })) ?? []),
  };
}

function xhsPickVideoUrl(data: XhsNote): string {
  const streams =
    data.video?.media?.stream?.h264 ??
    data.video_info_v2?.media?.stream?.h264 ??
    [];
  const first = streams[0];
  if (first?.master_url) return first.master_url;
  if (first?.backup_urls?.length) return first.backup_urls[0];
  throw new Error("Xiaohongshu note has no downloadable video content.");
}

async function xhsDownloadVideo(
  url: string,
  params: Record<string, unknown>,
): Promise<{ path: string; title: string; duration: number }> {
  const { data } = await xhsApiCall(parseXhsUrl(url), params);
  const title = data.title ?? data.desc ?? "Xiaohongshu note";

  // If video note, download video; otherwise download first image
  if (data.type === "video" || data.video?.media) {
    const videoUrl = xhsPickVideoUrl(data);
    const out = tempFile("mp4");
    await streamToFile(videoUrl, out, {});
    return { path: out, title, duration: 0 };
  }

  const imgUrl = data.image_list?.[0]?.url_default ?? data.image_list?.[0]?.url;
  if (!imgUrl)
    throw new Error("Xiaohongshu note has no downloadable image or video.");
  const out = tempFile("jpg");
  await streamToFile(imgUrl, out, {});
  return { path: out, title, duration: 0 };
}

async function xhsDownloadAudio(
  url: string,
  params: Record<string, unknown>,
): Promise<{ path: string; title: string; duration: number }> {
  const { data } = await xhsApiCall(parseXhsUrl(url), params);
  const title = data.title ?? data.desc ?? "Xiaohongshu note";
  const videoUrl = xhsPickVideoUrl(data);
  const vTmp = tempFile("mp4"),
    out = tempFile("mp3");
  try {
    await streamToFile(videoUrl, vTmp, {});
    const r = await runCommand(
      "ffmpeg",
      ["-y", "-i", vTmp, "-vn", "-c:a", "libmp3lame", "-q:a", "0", out],
      300_000,
    );
    if (r.exitCode !== 0)
      throw new Error(`ffmpeg澶辫触: ${r.stderr.slice(0, 200)}`);
    return { path: out, title, duration: 0 };
  } finally {
    tryUnlink(vTmp);
  }
}

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Platform router
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

type Platform = "bilibili" | "douyin" | "youtube" | "xiaohongshu" | "direct";
const PLATFORMS: Array<{ name: Platform; match: (u: string) => boolean }> = [
  { name: "bilibili", match: (u) => /bilibili\.com|b23\.tv/i.test(u) },
  {
    name: "douyin",
    match: (u) =>
      /douyin\.com\/video|iesdouyin\.com\/share\/video|v\.douyin\.com/i.test(u),
  },
  { name: "youtube", match: (u) => /youtube\.com|youtu\.be/i.test(u) },
  {
    name: "xiaohongshu",
    match: (u) => /xiaohongshu\.com|xhslink\.com|xhs\.link/i.test(u),
  },
  { name: "direct", match: (u) => looksLikeDirectVideoUrl(u) },
];

function detect(url: string): Platform | null {
  return PLATFORMS.find((p) => p.match(url))?.name ?? null;
}

function fail(code: string, msg: string, start: number) {
  return {
    status: "failed" as const,
    error: { code, message: msg },
    duration_ms: Date.now() - start,
  };
}

const UNSUPPORTED_MSG = [
  "Unsupported platform for the legacy media downloader.",
  "Supported legacy sources: Bilibili, Douyin, YouTube, Xiaohongshu, and direct video URLs.",
  "Enable VidBee to cover a wider range of media sources through the unified Ark backend.",
].join("\n");

type NormalizedVideoInfo = VideoInfo & {
  provider: MediaProviderName;
  provider_raw_platform?: string;
};

type DlResult = {
  path: string;
  title: string;
  duration: number;
  platform: string;
  provider: MediaProviderName;
  provider_job_id?: string;
  provider_raw_status?: string;
  thumbnail?: string;
  filesize?: number;
  resolution?: string;
  format?: string;
  uploader?: string;
  view_count?: number;
};

type MediaProviderFailure = Error & {
  code?: string;
  provider?: MediaProviderName;
  retryable?: boolean;
};

type MediaFn<T> = (u: string, p: Record<string, unknown>) => Promise<T>;

const infoFn: Record<Platform, MediaFn<VideoInfo>> = {
  bilibili: (u) => biliInfo(u),
  douyin: (u) => douyinInfo(u),
  youtube: (u) => ytInfo(u),
  xiaohongshu: xhsInfo,
  direct: (u) => directInfo(u),
};

const dlVideoFn: Record<
  Platform,
  MediaFn<{ path: string; title: string; duration: number }>
> = {
  bilibili: (u) => biliDownloadVideo(u),
  douyin: (u) => douyinDownloadVideo(u),
  youtube: (u) => ytDownloadVideo(u),
  xiaohongshu: xhsDownloadVideo,
  direct: (u) => directDownloadVideo(u),
};

const dlAudioFn: Record<
  Platform,
  MediaFn<{ path: string; title: string; duration: number }>
> = {
  bilibili: (u) => biliDownloadAudio(u),
  douyin: (u) => douyinDownloadAudio(u),
  youtube: (u) => ytDownloadAudio(u),
  xiaohongshu: xhsDownloadAudio,
  direct: (u) => directDownloadAudio(u),
};

const OTHER_PROVIDER: Record<MediaProviderName, MediaProviderName> = {
  legacy_internal: "vidbee",
  vidbee: "legacy_internal",
};

const getStringParam = (
  params: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
};

const getStringArrayParam = (
  params: Record<string, unknown>,
  keys: string[],
): string[] | undefined => {
  for (const key of keys) {
    const value = params[key];
    if (!Array.isArray(value)) {
      continue;
    }
    const normalized = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return undefined;
};

const toPositiveInt = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return Math.max(0, Math.floor(fallback));
};

const createMediaError = (
  code: string,
  message: string,
  provider?: MediaProviderName,
): MediaProviderFailure => {
  const error = new Error(message) as MediaProviderFailure;
  error.code = code;
  error.provider = provider;
  return error;
};

const normalizeProviderError = (
  error: unknown,
  provider: MediaProviderName,
): MediaProviderFailure => {
  if (error instanceof Error) {
    const existing = error as MediaProviderFailure;
    if (existing.code) {
      existing.provider = existing.provider ?? provider;
      return existing;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  let code = "media_error";

  if (
    normalized.includes("unsupported_platform") ||
    normalized.includes("unsupported platform")
  ) {
    code = "unsupported_platform";
  } else if (
    normalized.includes("auth") ||
    normalized.includes("cookie") ||
    normalized.includes("credential") ||
    normalized.includes("login")
  ) {
    code = "auth_required";
  } else if (
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    code = "timeout";
  } else if (
    normalized.includes("vidbee_unconfigured") ||
    normalized.includes("vidbee_rpc_failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound") ||
    normalized.includes("fetch failed")
  ) {
    code = "provider_unavailable";
  } else if (
    normalized.includes("download failed") ||
    normalized.includes("did not finish") ||
    normalized.includes("cannot access the downloaded file")
  ) {
    code = "download_failed";
  }

  return createMediaError(code, message, provider);
};

const errorCodePriority = [
  "download_failed",
  "auth_required",
  "timeout",
  "unsupported_platform",
  "provider_unavailable",
  "media_error",
];

const combineProviderErrors = (
  errors: MediaProviderFailure[],
): MediaProviderFailure => {
  if (errors.length === 1) {
    return errors[0];
  }

  const combinedMessage = errors
    .map((error) => `[${error.provider ?? "unknown"}] ${error.message}`)
    .join(" | ");

  const code =
    errorCodePriority.find((candidate) =>
      errors.some((error) => error.code === candidate),
    ) ?? "media_error";

  return createMediaError(code, combinedMessage, errors[0]?.provider);
};

const orderedProviders = (
  operation: MediaOperation,
  config = getMediaProviderConfig(),
): MediaProviderName[] => {
  const primary = config.providers[operation];
  if (!config.fallbackEnabled) {
    return [primary];
  }
  return [primary, OTHER_PROVIDER[primary]];
};

const buildVidBeeRuntimeSettings = (
  base: VidBeeRuntimeSettings,
  params: Record<string, unknown>,
): VidBeeRuntimeSettings | undefined => {
  const merged: VidBeeRuntimeSettings = { ...base };

  const downloadPath = getStringParam(params, [
    "download_path",
    "downloadPath",
  ]);
  if (downloadPath) {
    merged.downloadPath = downloadPath;
  }

  const cookiesPath = getStringParam(params, ["cookies_path", "cookiesPath"]);
  if (cookiesPath) {
    merged.cookiesPath = cookiesPath;
  }

  const browserForCookies = getStringParam(params, [
    "browser_for_cookies",
    "browserForCookies",
  ]);
  if (browserForCookies) {
    merged.browserForCookies = browserForCookies;
  }

  const proxy = getStringParam(params, ["proxy"]);
  if (proxy) {
    merged.proxy = proxy;
  }

  const hasAnySetting = Object.values(merged).some(
    (value) => value !== undefined && value !== "",
  );
  return hasAnySetting ? merged : undefined;
};

const resolutionFromVidBeeFormat = (
  format?: VidBeeVideoFormat,
): string | undefined => {
  if (!format) {
    return undefined;
  }
  if (typeof format.height === "number" && format.height > 0) {
    return `${Math.round(format.height)}p`;
  }
  if (typeof format.width === "number" && typeof format.height === "number") {
    return `${Math.round(format.width)}x${Math.round(format.height)}`;
  }
  if (format.ext) {
    return format.ext;
  }
  return undefined;
};

const noteFromVidBeeFormat = (format: VidBeeVideoFormat): string => {
  const parts: string[] = [];
  if (format.formatNote?.trim()) {
    parts.push(format.formatNote.trim());
  }
  if (typeof format.tbr === "number" && Number.isFinite(format.tbr)) {
    parts.push(`${Math.round(format.tbr)} kbps`);
  }
  if (format.vcodec && format.vcodec !== "none") {
    parts.push(format.vcodec);
  }
  if (format.acodec && format.acodec !== "none") {
    parts.push(format.acodec);
  }
  return parts.join(" / ") || format.ext;
};

const platformFromUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host.includes("youtube") || host === "youtu.be") return "youtube";
    if (host.includes("bilibili") || host.includes("b23.tv")) return "bilibili";
    if (host.includes("douyin") || host.includes("iesdouyin")) return "douyin";
    if (host.includes("xiaohongshu") || host.includes("xhs"))
      return "xiaohongshu";
    if (host.includes("twitter") || host === "x.com") return "x";
    if (host.includes("instagram")) return "instagram";
    const parts = host.split(".").filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return undefined;
  }
};

const normalizeProviderPlatform = (
  value: string | undefined,
): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("youtube")) return "youtube";
  if (normalized.includes("bili")) return "bilibili";
  if (normalized.includes("douyin")) return "douyin";
  if (normalized.includes("xiaohongshu") || normalized.includes("xhs"))
    return "xiaohongshu";
  if (normalized.includes("twitter") || normalized === "x") return "x";
  if (normalized.includes("instagram")) return "instagram";
  return normalized.replace(/[^a-z0-9]+/g, "_");
};

const inferVidBeePlatform = (
  url: string,
  extractorKey?: string,
  webpageUrl?: string,
): string => {
  return (
    platformFromUrl(webpageUrl) ??
    normalizeProviderPlatform(extractorKey) ??
    platformFromUrl(url) ??
    "vidbee"
  );
};

const normalizeVidBeeInfo = (
  url: string,
  video: VidBeeVideoInfo,
): NormalizedVideoInfo => ({
  title: video.title?.trim() || "Untitled media",
  thumbnail: video.thumbnail?.trim() || "",
  duration: toPositiveInt(video.duration, 0),
  uploader: video.uploader?.trim() || "",
  platform: inferVidBeePlatform(url, video.extractorKey, video.webpageUrl),
  view_count: toPositiveInt(video.viewCount, 0),
  formats: Array.isArray(video.formats)
    ? video.formats.map((format) => ({
        format_id: format.formatId,
        ext: format.ext,
        resolution: resolutionFromVidBeeFormat(format) ?? format.ext,
        note: noteFromVidBeeFormat(format),
        filesize_approx:
          typeof format.filesizeApprox === "number"
            ? format.filesizeApprox
            : typeof format.filesize === "number"
              ? format.filesize
              : undefined,
      }))
    : [],
  provider: "vidbee",
  provider_raw_platform:
    normalizeProviderPlatform(video.extractorKey) ??
    platformFromUrl(video.webpageUrl) ??
    "vidbee",
});

const selectVidBeeFormat = (
  formats: VidBeeVideoFormat[],
  params: Record<string, unknown>,
): VidBeeVideoFormat | undefined => {
  const requestedFormatId = getStringParam(params, ["format_id", "formatId"]);
  if (requestedFormatId) {
    const exact = formats.find(
      (format) => format.formatId === requestedFormatId,
    );
    if (exact) {
      return exact;
    }
  }

  const resolutionValue = getStringParam(params, ["resolution", "quality"]);
  const heightMatch = resolutionValue?.match(/(\d{3,4})/);
  if (heightMatch) {
    const requestedHeight = Number(heightMatch[1]);
    const candidates = formats
      .filter((format) => typeof format.height === "number")
      .sort((left, right) => (right.height ?? 0) - (left.height ?? 0));
    const sameOrLower = candidates.find(
      (format) => (format.height ?? 0) <= requestedHeight,
    );
    if (sameOrLower) {
      return sameOrLower;
    }
    if (candidates.length > 0) {
      return candidates[0];
    }
  }

  const requestedExt = getStringParam(params, ["ext", "video_ext", "videoExt"]);
  if (requestedExt) {
    const exact = formats.find(
      (format) => format.ext.toLowerCase() === requestedExt.toLowerCase(),
    );
    if (exact) {
      return exact;
    }
  }

  return undefined;
};

const runLegacyInfo = async (
  url: string,
  params: Record<string, unknown>,
): Promise<NormalizedVideoInfo> => {
  const platform = detect(url);
  if (!platform) {
    throw createMediaError(
      "unsupported_platform",
      UNSUPPORTED_MSG,
      "legacy_internal",
    );
  }
  try {
    const info = await infoFn[platform](url, params);
    return {
      ...info,
      platform: info.platform || platform,
      provider: "legacy_internal",
      provider_raw_platform: platform,
    };
  } catch (error) {
    throw normalizeProviderError(error, "legacy_internal");
  }
};

const runLegacyDownload = async (
  kind: "video" | "audio",
  url: string,
  params: Record<string, unknown>,
): Promise<DlResult> => {
  const platform = detect(url);
  if (!platform) {
    throw createMediaError(
      "unsupported_platform",
      UNSUPPORTED_MSG,
      "legacy_internal",
    );
  }

  try {
    const info = await infoFn[platform](url, params);
    const result =
      kind === "video"
        ? await dlVideoFn[platform](url, params)
        : await dlAudioFn[platform](url, params);

    return {
      path: result.path,
      title: result.title,
      duration: result.duration,
      platform: info.platform || platform,
      provider: "legacy_internal",
      thumbnail: info.thumbnail,
      uploader: info.uploader,
      view_count: info.view_count,
      format: kind === "audio" ? "mp3" : undefined,
    };
  } catch (error) {
    throw normalizeProviderError(error, "legacy_internal");
  }
};

const runVidBeeInfo = async (
  url: string,
  params: Record<string, unknown>,
): Promise<NormalizedVideoInfo> => {
  const config = getMediaProviderConfig();
  const client = new VidBeeClient(config.vidbee);
  const settings = buildVidBeeRuntimeSettings(
    config.vidbee.runtimeSettings,
    params,
  );

  try {
    const video = await client.getVideoInfo(url, settings);
    return normalizeVidBeeInfo(url, video);
  } catch (error) {
    throw normalizeProviderError(error, "vidbee");
  }
};

const runVidBeeDownload = async (
  kind: "video" | "audio",
  url: string,
  params: Record<string, unknown>,
): Promise<DlResult> => {
  const config = getMediaProviderConfig();
  const client = new VidBeeClient(config.vidbee);
  const settings = buildVidBeeRuntimeSettings(
    config.vidbee.runtimeSettings,
    params,
  );

  try {
    const video = await client.getVideoInfo(url, settings);
    const normalizedInfo = normalizeVidBeeInfo(url, video);
    const selectedFormat =
      kind === "video"
        ? selectVidBeeFormat(video.formats ?? [], params)
        : undefined;
    const requestedFormat = getStringParam(params, ["format"]);
    const requestedAudioFormat =
      getStringParam(params, ["audio_format", "audioFormat", "format"]) ??
      "mp3";
    const requestedAudioFormatIds = getStringArrayParam(params, [
      "audio_format_ids",
      "audioFormatIds",
    ]);

    const created = await client.createDownload({
      url,
      type: kind,
      title: video.title,
      thumbnail: video.thumbnail,
      duration: video.duration,
      description: video.description,
      uploader: video.uploader,
      viewCount: video.viewCount,
      tags: video.tags,
      selectedFormat,
      format: kind === "video" ? requestedFormat : undefined,
      audioFormat: kind === "audio" ? requestedAudioFormat : undefined,
      audioFormatIds: kind === "audio" ? requestedAudioFormatIds : undefined,
      customDownloadPath: getStringParam(params, [
        "download_path",
        "downloadPath",
      ]),
      settings,
    });

    const task = await client.waitForDownload(created.id);
    if (task.status !== "completed") {
      throw createMediaError(
        "download_failed",
        task.error?.trim() ||
          `VidBee download ended with status ${task.status}.`,
        "vidbee",
      );
    }

    const localPath = client.resolveLocalFilePath(task);
    if (!localPath || !existsSync(localPath)) {
      throw createMediaError(
        "download_failed",
        "VidBee completed the task but Ark cannot access the downloaded file. Ensure both services share the same download directory.",
        "vidbee",
      );
    }

    const finalFormat = task.selectedFormat ?? selectedFormat;
    const fallbackFormat =
      kind === "audio"
        ? requestedAudioFormat
        : (finalFormat?.ext ?? getStringParam(params, ["format"]) ?? "mp4");

    return {
      path: localPath,
      title: task.title?.trim() || normalizedInfo.title,
      duration: toPositiveInt(task.duration, normalizedInfo.duration),
      platform: normalizedInfo.platform,
      provider: "vidbee",
      provider_job_id: task.id,
      provider_raw_status: task.status,
      thumbnail: task.thumbnail?.trim() || normalizedInfo.thumbnail,
      filesize: typeof task.fileSize === "number" ? task.fileSize : undefined,
      resolution:
        kind === "video" ? resolutionFromVidBeeFormat(finalFormat) : undefined,
      format: fallbackFormat,
      uploader: task.uploader?.trim() || normalizedInfo.uploader,
      view_count:
        typeof task.viewCount === "number"
          ? task.viewCount
          : normalizedInfo.view_count,
    };
  } catch (error) {
    throw normalizeProviderError(error, "vidbee");
  }
};

const executeMediaOperation = async <T>(
  operation: MediaOperation,
  runners: Record<MediaProviderName, () => Promise<T>>,
): Promise<T> => {
  const providers = orderedProviders(operation);
  const errors: MediaProviderFailure[] = [];

  for (const provider of providers) {
    try {
      return await runners[provider]();
    } catch (error) {
      errors.push(normalizeProviderError(error, provider));
    }
  }

  throw combineProviderErrors(errors);
};

const videoInfoManifest: ToolManifest = {
  id: "media.video_info",
  name: "Media Video Info",
  description:
    "Fetch normalized media metadata through Ark's unified media provider layer.",
  category: "video",
  tags: ["video", "info", "media", "download", "metadata"],
  params: [
    {
      name: "url",
      type: "string",
      required: true,
      description: "Video or media page URL.",
    },
  ],
  output_type: "json",
  keywords: ["video info", "media info", "download metadata", "video url"],
  patterns: ["(video|media|download).*info"],
};

const videoInfoHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = typeof params.url === "string" ? params.url.trim() : "";
  if (!url) {
    return fail("bad_request", "Missing required parameter: url", start);
  }

  try {
    const info = await executeMediaOperation("video_info", {
      legacy_internal: () => runLegacyInfo(url, params),
      vidbee: () => runVidBeeInfo(url, params),
    });
    return {
      status: "success",
      output: {
        ...info,
        duration_str: formatDuration(info.duration),
      },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    const normalized = normalizeProviderError(error, "legacy_internal");
    return fail(normalized.code ?? "media_error", normalized.message, start);
  }
};

export const mediaVideoInfo: ToolRegistryEntry = {
  manifest: videoInfoManifest,
  handler: videoInfoHandler,
  timeout: LONG_TIMEOUT_MS,
};

const downloadVideoManifest: ToolManifest = {
  id: "media.download_video",
  name: "Media Download Video",
  description: "Download video through Ark's unified media provider layer.",
  category: "video",
  tags: ["download", "video", "media"],
  params: [
    { name: "url", type: "string", required: true, description: "Video URL" },
  ],
  output_type: "file",
  keywords: ["download video", "media download", "save video"],
  patterns: ["download.*video"],
};

const downloadVideoHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = typeof params.url === "string" ? params.url.trim() : "";
  if (!url) {
    return fail("bad_request", "Missing required parameter: url", start);
  }

  try {
    const result = await executeMediaOperation("download_video", {
      legacy_internal: () => runLegacyDownload("video", url, params),
      vidbee: () => runVidBeeDownload("video", url, params),
    });
    return {
      status: "success",
      output_url: result.path,
      output: {
        title: result.title,
        duration: result.duration,
        duration_str: formatDuration(result.duration),
        platform: result.platform,
        thumbnail: result.thumbnail,
        provider: result.provider,
        provider_job_id: result.provider_job_id,
        provider_raw_status: result.provider_raw_status,
        uploader: result.uploader,
        view_count: result.view_count,
        filesize: result.filesize,
        resolution: result.resolution,
        format: result.format,
      },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    const normalized = normalizeProviderError(error, "legacy_internal");
    return fail(normalized.code ?? "media_error", normalized.message, start);
  }
};

export const mediaDownloadVideo: ToolRegistryEntry = {
  manifest: downloadVideoManifest,
  handler: downloadVideoHandler,
  timeout: LONG_TIMEOUT_MS,
};

const downloadAudioManifest: ToolManifest = {
  id: "media.download_audio",
  name: "Media Download Audio",
  description: "Extract audio through Ark's unified media provider layer.",
  category: "video",
  tags: ["download", "audio", "media", "mp3"],
  params: [
    { name: "url", type: "string", required: true, description: "Video URL" },
  ],
  output_type: "file",
  keywords: ["download audio", "extract audio", "save audio"],
  patterns: ["download.*audio"],
};

const downloadAudioHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const url = typeof params.url === "string" ? params.url.trim() : "";
  if (!url) {
    return fail("bad_request", "Missing required parameter: url", start);
  }

  try {
    const result = await executeMediaOperation("download_audio", {
      legacy_internal: () => runLegacyDownload("audio", url, params),
      vidbee: () => runVidBeeDownload("audio", url, params),
    });
    return {
      status: "success",
      output_url: result.path,
      output: {
        title: result.title,
        duration: result.duration,
        duration_str: formatDuration(result.duration),
        format: result.format ?? "mp3",
        platform: result.platform,
        thumbnail: result.thumbnail,
        provider: result.provider,
        provider_job_id: result.provider_job_id,
        provider_raw_status: result.provider_raw_status,
        uploader: result.uploader,
        view_count: result.view_count,
        filesize: result.filesize,
      },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    const normalized = normalizeProviderError(error, "legacy_internal");
    return fail(normalized.code ?? "media_error", normalized.message, start);
  }
};

export const mediaDownloadAudio: ToolRegistryEntry = {
  manifest: downloadAudioManifest,
  handler: downloadAudioHandler,
  timeout: LONG_TIMEOUT_MS,
};
const extractSubtitleManifest: ToolManifest = {
  id: "media.extract_subtitle",
  name: "Media Extract Subtitle",
  description:
    "Extract subtitles from supported media links with a unified TXT/SRT/VTT result contract.",
  category: "video",
  tags: ["subtitle", "caption", "srt", "vtt", "瀛楀箷", "bilibili", "youtube"],
  params: [
    {
      name: "url",
      type: "string",
      required: true,
      description: "Supported media URL",
    },
    {
      name: "language",
      type: "string",
      required: false,
      default: "zh-Hans",
      description: "Preferred subtitle language code",
    },
  ],
  output_type: "json",
  keywords: [
    "瀛楀箷",
    "subtitle",
    "caption",
    "鎻愬彇瀛楀箷",
    "youtube subtitle",
    "bilibili subtitle",
  ],
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

export const mediaExtractSubtitle: ToolRegistryEntry = {
  manifest: extractSubtitleManifest,
  handler: extractSubtitleHandler,
  timeout: LONG_TIMEOUT_MS,
};
