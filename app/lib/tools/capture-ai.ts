// @input: recorded audio/video file URLs from native island
// @output: transcript/summary json derived from real provider-backed analysis
// @position: capture post-processing tools for Audio Notes and Screen Record

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { generateText } from "ai";
import WebSocket from "ws";
import type {
  ToolHandler,
  ToolManifest,
  ToolRegistryEntry,
} from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { createChatModel } from "@/lib/server/llm-provider";
import { downloadFile, runCommand } from "./helpers";

const ok = (
  output: Record<string, unknown>,
  start: number,
): ReturnType<ToolHandler> =>
  Promise.resolve({
    status: "success",
    output,
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

const clean = (value: unknown): string => String(value ?? "").trim();

type EnvMap = Map<string, string>;

let cachedWorkspaceEnv: EnvMap | undefined;

const ENV_CANDIDATES = [
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
  resolve(process.cwd(), "..", "..", "..", ".env"),
];

const parseEnvFile = (raw: string, target: EnvMap): void => {
  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!target.has(match[1])) {
      target.set(match[1], value);
    }
  }
};

const workspaceEnv = (): EnvMap => {
  if (cachedWorkspaceEnv) return cachedWorkspaceEnv;
  const env = new Map<string, string>();
  for (const file of ENV_CANDIDATES) {
    if (!existsSync(file)) continue;
    try {
      parseEnvFile(readFileSync(file, "utf8"), env);
    } catch {
      // Best-effort env fallback.
    }
  }
  cachedWorkspaceEnv = env;
  return env;
};

const envValue = (...keys: string[]): string | undefined => {
  const localEnv = workspaceEnv();
  for (const key of keys) {
    const processValue = clean(process.env[key]);
    if (processValue) return processValue;
    const fileValue = clean(localEnv.get(key));
    if (fileValue) return fileValue;
  }
  return undefined;
};

const normalizeBaseUrl = (
  value: string | undefined,
  fallback: string,
): string => {
  const normalized = clean(value).replace(/\/+$/, "");
  if (!normalized) return fallback;
  return normalized.replace(/\/v1beta$/i, "").replace(/\/v1$/i, "");
};

const ffmpegBin = () =>
  envValue("FFMPEG_PATH") ||
  resolve(
    process.cwd(),
    "..",
    "..",
    "..",
    "tools",
    "ffmpeg",
    "ffmpeg-8.0.1-essentials_build",
    "bin",
    "ffmpeg.exe",
  ) ||
  "ffmpeg";

const ffprobeBin = () =>
  envValue("FFPROBE_PATH") ||
  resolve(
    process.cwd(),
    "..",
    "..",
    "..",
    "tools",
    "ffmpeg",
    "ffmpeg-8.0.1-essentials_build",
    "bin",
    "ffprobe.exe",
  ) ||
  "ffprobe";

type VolcHeader = {
  version: number;
  headerSize: number;
  messageType: number;
  flags: number;
  serialization: number;
  compression: number;
};

const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE = 0b0001;
const MSG_FULL_CLIENT_REQUEST = 0b0001;
const MSG_AUDIO_ONLY_REQUEST = 0b0010;
const MSG_ERROR_RESPONSE = 0b1111;
const FLAG_NO_SEQUENCE = 0b0000;
const FLAG_POSITIVE_SEQUENCE = 0b0001;
const FLAG_LAST_PACKET_NO_SEQ = 0b0010;
const FLAG_LAST_PACKET_WITH_SEQ = 0b0011;
const SERIAL_NONE = 0b0000;
const SERIAL_JSON = 0b0001;
const COMPRESS_GZIP = 0b0001;

const buildVolcHeader = (
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
): Buffer =>
  Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ]);

const parseVolcHeader = (buffer: Buffer): VolcHeader => ({
  version: (buffer[0] >> 4) & 0x0f,
  headerSize: (buffer[0] & 0x0f) * 4,
  messageType: (buffer[1] >> 4) & 0x0f,
  flags: buffer[1] & 0x0f,
  serialization: (buffer[2] >> 4) & 0x0f,
  compression: buffer[2] & 0x0f,
});

const parseVolcResponse = (data: WebSocket.RawData) => {
  const buffer =
    typeof data === "string"
      ? Buffer.from(data)
      : Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
  const header = parseVolcHeader(buffer);
  let offset = header.headerSize;

  if (
    header.flags === FLAG_POSITIVE_SEQUENCE ||
    header.flags === FLAG_LAST_PACKET_WITH_SEQ
  ) {
    offset += 4;
  }

  if (header.messageType === MSG_ERROR_RESPONSE) {
    const errorCode = buffer.readUInt32BE(offset);
    offset += 4;
    const errorMsgSize = buffer.readUInt32BE(offset);
    offset += 4;
    const errorMessage = buffer
      .slice(offset, offset + errorMsgSize)
      .toString("utf8");
    return { error: true, code: errorCode, message: errorMessage };
  }

  const payloadSize = buffer.readUInt32BE(offset);
  offset += 4;
  let payload = buffer.slice(offset, offset + payloadSize);
  if (header.compression === COMPRESS_GZIP) {
    payload = gunzipSync(payload);
  }

  if (header.serialization === SERIAL_JSON) {
    return {
      error: false,
      isLast: header.flags === FLAG_LAST_PACKET_NO_SEQ,
      data: JSON.parse(payload.toString("utf8")) as Record<string, unknown>,
    };
  }

  return {
    error: false,
    isLast:
      header.flags === FLAG_LAST_PACKET_NO_SEQ ||
      header.flags === FLAG_LAST_PACKET_WITH_SEQ,
    data: payload,
  };
};

type CaptureSummaryParts = {
  headline: string;
  summary: string;
  nextStep?: string;
};

const defaultCaptureHeadline = (kind: "audio" | "video"): string =>
  kind === "audio" ? "Audio note captured" : "Screen recording captured";

const defaultCaptureSummary = (kind: "audio" | "video"): string =>
  kind === "audio"
    ? "The note was transcribed and summarized."
    : "The recording was analyzed and summarized.";

const stripCaptureLinePrefix = (line: string): string =>
  line.replace(/^(headline|title|summary|overview)\s*:\s*/i, "").trim();

const stripNextStepPrefix = (line: string): string =>
  line
    .replace(/^(next|next step|follow-up|follow up|action)\s*:\s*/i, "")
    .trim();

const parseCaptureSummary = (
  kind: "audio" | "video",
  text: string,
): CaptureSummaryParts => {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const infoLines: string[] = [];
  let nextStep = "";

  for (const rawLine of lines) {
    if (/^(next|next step|follow-up|follow up|action)\s*:/i.test(rawLine)) {
      if (!nextStep) {
        nextStep = stripNextStepPrefix(rawLine);
      }
      continue;
    }
    infoLines.push(stripCaptureLinePrefix(rawLine));
  }

  const headline = infoLines[0] || defaultCaptureHeadline(kind);
  const summary =
    infoLines.slice(1).join(" ").trim() || defaultCaptureSummary(kind);
  return {
    headline,
    summary,
    nextStep: nextStep || undefined,
  };
};

const summarizeCapturedText = async (
  kind: "audio" | "video",
  body: string,
  extraContext?: string,
): Promise<string> => {
  const trimmed = body.trim();
  if (!trimmed) {
    return kind === "audio"
      ? "Audio note captured, but the transcript was empty."
      : "Screen recording captured, but the visual summary was empty.";
  }

  const { model } = createChatModel();
  const { text } = await generateText({
    model,
    temperature: 0.2,
    prompt: [
      kind === "audio"
        ? "You summarize a freshly captured voice note."
        : "You summarize a freshly captured screen recording.",
      kind === "audio"
        ? "Assume the recording has already finished and the note has already been transcribed."
        : "Assume the screen recording has already finished and the video has already been analyzed.",
      "Return plain text only.",
      "Keep it concise and useful for a Dynamic Island result.",
      "Return exactly 2 or 3 lines.",
      "Line 1: a short headline, at most 5 words.",
      "Line 2: one concise summary sentence in past tense.",
      "Line 3: optional. If included, it must begin with 'Next:' and suggest only after-the-fact actions such as review, share, save, summarize, or extract follow-ups.",
      "Never tell the user to stop, end, or finish the recording or capture.",
      "Do not mention Dynamic Island, UI layout, or that the file is still recording.",
      extraContext ? `Extra context: ${extraContext}` : "",
      `${kind === "audio" ? "Transcript" : "Visual analysis"}:`,
      trimmed,
    ]
      .filter(Boolean)
      .join("\n"),
  });
  return text.trim();
};

const formatCaptureDuration = (
  kind: "audio" | "video",
  duration: number | undefined,
): string => {
  if (!Number.isFinite(duration) || !duration || duration <= 0) {
    return "";
  }
  if (kind === "audio") {
    return `${Math.round(duration)} ms`;
  }
  return `${duration.toFixed(1)} s`;
};

const buildCaptureReportMarkdown = (
  kind: "audio" | "video",
  data: {
    summary: string;
    transcript?: string;
    analysis?: string;
    contextHint?: string;
    provider?: string;
    model?: string;
    durationMs?: number;
    durationSeconds?: number;
    sourceFileName?: string;
  },
): string => {
  const parts = parseCaptureSummary(kind, data.summary);
  const metadata = [
    `- Generated: ${new Date().toISOString()}`,
    data.sourceFileName ? `- Source file: ${data.sourceFileName}` : "",
    data.provider ? `- Provider: ${data.provider}` : "",
    data.model ? `- Model: ${data.model}` : "",
    kind === "audio"
      ? `- Duration: ${formatCaptureDuration(kind, data.durationMs)}`
      : `- Duration: ${formatCaptureDuration(kind, data.durationSeconds)}`,
  ].filter(Boolean);
  const lines = [
    `# ${kind === "audio" ? "Audio Notes Report" : "Screen Record Report"}`,
    "",
    ...metadata,
    "",
    "## Overview",
    "",
    `**${parts.headline}**`,
    "",
    parts.summary,
  ].filter(Boolean);

  if (parts.nextStep) {
    lines.push("", "## Suggested Next Step", "", parts.nextStep);
  }

  if (data.contextHint?.trim()) {
    lines.push("", "## Requested Focus", "", data.contextHint.trim());
  }

  if (kind === "audio") {
    lines.push(
      "",
      "## Transcript",
      "",
      data.transcript?.trim() || "Transcript was empty.",
    );
  } else {
    lines.push(
      "",
      "## Visual Analysis",
      "",
      data.analysis?.trim() || "Analysis was empty.",
    );
  }

  return `${lines.join("\n")}\n`;
};

type SubtitleSegment = {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
};

const subtitleMimeType = (format: "txt" | "srt" | "vtt" | "zip"): string => {
  switch (format) {
    case "txt":
      return "text/plain; charset=utf-8";
    case "srt":
      return "application/x-subrip; charset=utf-8";
    case "vtt":
      return "text/vtt; charset=utf-8";
    case "zip":
      return "application/zip";
  }
};

const sanitizeArtifactBasename = (value: string, fallback: string): string => {
  const stem = value.replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
  return safe || fallback;
};

const parseDurationLike = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return undefined;
    if (!Number.isInteger(value)) return Math.round(value * 1000);
    return value;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{1,2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    const [hours, minutes, seconds] = trimmed.split(":");
    const totalSeconds =
      Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    return Math.round(totalSeconds * 1000);
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (trimmed.includes(".")) {
    return Math.round(numeric * 1000);
  }
  return numeric;
};

const pickObjectNumber = (
  object: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    const parsed = parseDurationLike(object[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const pickObjectText = (
  object: Record<string, unknown>,
  keys: string[],
): string => {
  for (const key of keys) {
    const text = clean(object[key]);
    if (text) return text;
  }
  return "";
};

const splitTranscriptSentences = (transcript: string): string[] => {
  const normalized = transcript
    .replace(/\r/g, "\n")
    .split(/\n+/g)
    .flatMap((line) =>
      line
        .split(/(?<=[。！？!?；;.!?])\s+/g)
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .filter(Boolean);
  if (normalized.length > 0) return normalized;
  const fallback = transcript.trim();
  return fallback ? [fallback] : [];
};

const buildFallbackSubtitleSegments = (
  transcript: string,
  durationMs: number,
): SubtitleSegment[] => {
  const parts = splitTranscriptSentences(transcript);
  if (!parts.length) return [];
  const totalDuration = Math.max(
    durationMs || parts.length * 2500,
    parts.length * 1200,
  );
  const slot = Math.max(1200, Math.round(totalDuration / parts.length));
  return parts.map((text, index) => {
    const startMs = Math.min(totalDuration - 1, index * slot);
    const isLast = index === parts.length - 1;
    const endMs = isLast
      ? totalDuration
      : Math.min(totalDuration, (index + 1) * slot);
    return {
      index: index + 1,
      start_ms: startMs,
      end_ms: Math.max(startMs + 800, endMs),
      text,
    };
  });
};

const buildSubtitleSegments = (
  transcript: string,
  utterances: unknown[],
  durationMs: number,
): SubtitleSegment[] => {
  const fromUtterances = utterances
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const record = item as Record<string, unknown>;
      const text = pickObjectText(record, [
        "text",
        "utterance",
        "transcript",
        "sentence",
      ]);
      if (!text) return undefined;
      const startMs = pickObjectNumber(record, [
        "start_ms",
        "start",
        "start_time_ms",
        "start_time",
      ]);
      const endMs = pickObjectNumber(record, [
        "end_ms",
        "end",
        "end_time_ms",
        "end_time",
      ]);
      if (startMs === undefined || endMs === undefined || endMs <= startMs) {
        return undefined;
      }
      return {
        index: 0,
        start_ms: startMs,
        end_ms: endMs,
        text,
      };
    })
    .filter((item): item is SubtitleSegment => Boolean(item))
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((item, index) => ({
      ...item,
      index: index + 1,
    }));

  if (fromUtterances.length > 0) {
    return fromUtterances;
  }
  return buildFallbackSubtitleSegments(transcript, durationMs);
};

const formatSubtitleTimestamp = (
  valueMs: number,
  format: "srt" | "vtt",
): string => {
  const clamped = Math.max(0, Math.round(valueMs));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  const separator = format === "srt" ? "," : ".";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
};

export const buildSubtitleTexts = (
  transcript: string,
  utterances: unknown[],
  durationMs: number,
): {
  txtText: string;
  srtText: string;
  vttText: string;
  segments: SubtitleSegment[];
} => {
  const normalizedTranscript = transcript.trim();
  const segments = buildSubtitleSegments(
    normalizedTranscript || "Transcript was empty.",
    utterances,
    durationMs,
  );
  const txtText = normalizedTranscript || "Transcript was empty.";
  const srtText = segments
    .map(
      (segment) =>
        `${segment.index}\n${formatSubtitleTimestamp(segment.start_ms, "srt")} --> ${formatSubtitleTimestamp(segment.end_ms, "srt")}\n${segment.text}`,
    )
    .join("\n\n");
  const vttBody = segments
    .map(
      (segment) =>
        `${formatSubtitleTimestamp(segment.start_ms, "vtt")} --> ${formatSubtitleTimestamp(segment.end_ms, "vtt")}\n${segment.text}`,
    )
    .join("\n\n");
  return {
    txtText,
    srtText,
    vttText: `WEBVTT\n\n${vttBody}\n`,
    segments,
  };
};

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

const crc32 = (buffer: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const createZipBundle = (
  baseName: string,
  files: Array<{ name: string; contents: string }>,
): { path: string; fileName: string } => {
  const zipName = `${baseName}-subtitles.zip`;
  const zipPath = join(tmpdir(), `omni-subtitles-${randomUUID()}.zip`);
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
};

const inferAudioFormat = (filePath: string): string => {
  const ext = extname(filePath).replace(/^\./, "").toLowerCase();
  if (ext === "m4a") return "mp4";
  return ext || "wav";
};

export const normalizeAudioForAsr = async (sourcePath: string): Promise<string> => {
  const targetPath = join(tmpdir(), `omni-capture-asr-${randomUUID()}.wav`);
  const result = await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-i",
      sourcePath,
      "-af",
      "highpass=f=80,lowpass=f=7200,dynaudnorm=f=150:g=31,silenceremove=start_periods=1:start_silence=0.2:start_threshold=-45dB:stop_periods=-1:stop_silence=0.4:stop_threshold=-45dB",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-sample_fmt",
      "s16",
      targetPath,
    ],
    120_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to normalize audio for ASR.");
  }
  return targetPath;
};

export const transcribeWithVolcengine = async (
  audioPath: string,
  language: string,
): Promise<{
  text: string;
  durationMs: number;
  provider: string;
  utterances: unknown[];
  raw: Record<string, unknown> | undefined;
}> => {
  const appId = envValue("VOLCENGINE_APPID");
  const accessToken = envValue("VOLCENGINE_ACCESS_TOKEN");
  const resourceId =
    envValue("VOLCENGINE_ASR_RESOURCE_ID") || "volc.seedasr.sauc.duration";
  if (!appId || !accessToken) {
    throw new Error("Volcengine ASR is not configured.");
  }

  const ws = new WebSocket(
    "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream",
    {
      headers: {
        "X-Api-App-Key": appId,
        "X-Api-Access-Key": accessToken,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Connect-Id": randomUUID(),
      },
      handshakeTimeout: 15_000,
    },
  );

  const audioBuffer = readFileSync(audioPath);
  const audioFormat = inferAudioFormat(audioPath);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ws.off("open", onOpen);
      ws.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    ws.on("open", onOpen);
    ws.on("error", onError);
  });

  const initPayload = {
    user: { uid: "omniagent-island" },
    audio: {
      format: audioFormat,
      rate: 16_000,
      bits: 16,
      channel: 1,
      language,
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      show_utterances: true,
      result_type: "full",
    },
  };
  const initJson = Buffer.from(JSON.stringify(initPayload));
  const initCompressed = gzipSync(initJson);
  const initSize = Buffer.alloc(4);
  initSize.writeUInt32BE(initCompressed.length);
  const initPacket = Buffer.concat([
    buildVolcHeader(
      MSG_FULL_CLIENT_REQUEST,
      FLAG_NO_SEQUENCE,
      SERIAL_JSON,
      COMPRESS_GZIP,
    ),
    initSize,
    initCompressed,
  ]);

  const audioCompressed = gzipSync(audioBuffer);
  const audioSize = Buffer.alloc(4);
  audioSize.writeUInt32BE(audioCompressed.length);
  const audioPacket = Buffer.concat([
    buildVolcHeader(
      MSG_AUDIO_ONLY_REQUEST,
      FLAG_LAST_PACKET_NO_SEQ,
      SERIAL_NONE,
      COMPRESS_GZIP,
    ),
    audioSize,
    audioCompressed,
  ]);

  const response = await new Promise<Record<string, unknown> | undefined>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Volcengine ASR timed out."));
      }, 30_000);
      let finalResult: Record<string, unknown> | undefined;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;

      const closeWith = (value?: Record<string, unknown>) => {
        clearTimeout(timeout);
        if (settleTimer) clearTimeout(settleTimer);
        ws.removeAllListeners("message");
        ws.removeAllListeners("error");
        try {
          ws.close();
        } catch {
          // ignore
        }
        resolve(value);
      };

      ws.on("message", (chunk: WebSocket.RawData) => {
        try {
          const parsed = parseVolcResponse(chunk);
          if (parsed.error) {
            clearTimeout(timeout);
            reject(
              new Error(
                `Volcengine ASR error ${parsed.code}: ${parsed.message}`,
              ),
            );
            return;
          }
          const json = parsed.data as Record<string, unknown> | undefined;
          const result = json?.result as Record<string, unknown> | undefined;
          if (result && typeof result.text === "string" && result.text.trim()) {
            finalResult = json;
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => closeWith(finalResult), 1200);
          }
          if (parsed.isLast) {
            closeWith(finalResult);
          }
        } catch (error) {
          clearTimeout(timeout);
          if (settleTimer) clearTimeout(settleTimer);
          reject(error);
        }
      });

      ws.on("error", (error: Error) => {
        clearTimeout(timeout);
        if (settleTimer) clearTimeout(settleTimer);
        reject(error);
      });

      ws.send(initPacket, (error?: Error) => {
        if (error) {
          clearTimeout(timeout);
          reject(error);
          return;
        }
        ws.send(audioPacket, (sendError?: Error) => {
          if (sendError) {
            clearTimeout(timeout);
            reject(sendError);
          }
        });
      });
    },
  );

  const rawResult = response;
  const result = rawResult?.result as Record<string, unknown> | undefined;
  const text = typeof result?.text === "string" ? result.text.trim() : "";
  const utterances = Array.isArray(result?.utterances) ? result.utterances : [];
  const audioInfo = rawResult?.audio_info as
    | Record<string, unknown>
    | undefined;
  const durationMs =
    typeof audioInfo?.duration === "number" ? audioInfo.duration : 0;

  return {
    text,
    durationMs,
    provider: "volcengine-bigmodel",
    utterances,
    raw: rawResult,
  };
};

const fileToInlinePart = (filePath: string, mimeType: string) => ({
  inlineData: {
    mimeType,
    data: readFileSync(filePath).toString("base64"),
  },
});

const extractTextFromGemini = (
  payload: Record<string, unknown> | undefined,
): string => {
  const candidates = Array.isArray(payload?.candidates)
    ? payload.candidates
    : [];
  const lines: string[] = [];
  for (const candidate of candidates) {
    const content = (candidate as Record<string, unknown>).content as
      | Record<string, unknown>
      | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const text = clean((part as Record<string, unknown>).text);
      if (text) lines.push(text);
    }
  }
  return lines.join("\n").trim();
};

const sanitizeVideoAnalysisText = (text: string): string =>
  text
    .replace(
      /\b(?:the\s+)?next step is to stop (?:the )?(?:screen )?recording\.?\s*/gi,
      "",
    )
    .replace(/\bnext:\s*stop (?:the )?(?:screen )?recording\.?\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const probeVideo = async (
  filePath: string,
): Promise<{
  durationSec: number;
  width?: number;
  height?: number;
}> => {
  const result = await runCommand(ffprobeBin(), [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    filePath,
  ]);
  if (result.exitCode !== 0) {
    return { durationSec: 0 };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    return {
      durationSec: Number(parsed.format?.duration || 0),
      width: parsed.streams?.[0]?.width,
      height: parsed.streams?.[0]?.height,
    };
  } catch {
    return { durationSec: 0 };
  }
};

const extractVideoFrames = async (
  filePath: string,
): Promise<{
  frames: string[];
  durationSec: number;
  width?: number;
  height?: number;
}> => {
  const info = await probeVideo(filePath);
  const tmp = mkdtempSync(join(tmpdir(), "omni-video-frames-"));
  const intervalSec =
    info.durationSec > 0 ? Math.max(2, Math.ceil(info.durationSec / 6)) : 3;
  const framePattern = join(tmp, "frame-%02d.jpg");
  const command = await runCommand(
    ffmpegBin(),
    [
      "-y",
      "-i",
      filePath,
      "-vf",
      `fps=1/${intervalSec},scale='min(1280,iw)':-2`,
      "-frames:v",
      "6",
      framePattern,
    ],
    120_000,
  );
  if (command.exitCode !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(command.stderr || "Failed to extract video frames.");
  }

  const frames = Array.from({ length: 6 }, (_, index) =>
    join(tmp, `frame-${String(index + 1).padStart(2, "0")}.jpg`),
  ).filter((file) => existsSync(file));

  if (!frames.length) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error("No frames were extracted from the screen recording.");
  }

  return {
    frames,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
  };
};

const analyzeVideoWithGemini = async (videoPath: string, prompt: string) => {
  const apiKey = envValue(
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OMNIAGENT_RELAY_API_KEY",
  );
  if (!apiKey) {
    throw new Error("Gemini / Google API key is not configured.");
  }
  const baseUrl = normalizeBaseUrl(
    envValue("GEMINI_BASE_URL", "OMNIAGENT_RELAY_BASE_URL"),
    "https://generativelanguage.googleapis.com",
  );
  const models = Array.from(
    new Set(
      [
        envValue("GEMINI_VIDEO_MODEL"),
        envValue("GEMINI_MODEL"),
        envValue("OMNIAGENT_RELAY_MODEL"),
        "gemini-2.5-flash",
        "gemini-1.5-flash",
      ].filter((value): value is string => Boolean(clean(value))),
    ),
  );

  const extracted = await extractVideoFrames(videoPath);
  const parts: Array<Record<string, unknown>> = [
    {
      text: [
        "Analyze this screen recording based on sampled frames from the real captured video.",
        "Return plain text only.",
        "Assume the recording has already ended.",
        "Describe what the user was doing and the most important screen changes in 2 to 4 concise sentences.",
        "If you include a next step, it must be an after-the-fact follow-up such as review, share, summarize, or extract tasks.",
        "Never suggest stopping, ending, or finishing the recording.",
        "Do not mention Dynamic Island or UI chrome.",
        extracted.durationSec > 0
          ? `Duration: ${extracted.durationSec.toFixed(1)} seconds.`
          : "",
        extracted.width && extracted.height
          ? `Resolution: ${extracted.width}x${extracted.height}.`
          : "",
        prompt ? `User hint: ${prompt}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  for (const frame of extracted.frames) {
    parts.push(fileToInlinePart(frame, "image/jpeg"));
  }

  let response;
  let payload: Record<string, unknown> | undefined;
  let chosenModel = models[0] || "gemini-1.5-flash";
  let lastErrorMessage = "";
  for (const model of models.length ? models : ["gemini-1.5-flash"]) {
    chosenModel = model;
    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(220_000),
    });

    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = undefined;
    }

    if (response.ok) {
      lastErrorMessage = "";
      break;
    }

    lastErrorMessage =
      clean((payload?.error as Record<string, unknown> | undefined)?.message) ||
      `Gemini returned ${response.status}`;
    const retryableModelMiss =
      /no available channels|model .* not found|unsupported model/i.test(
        lastErrorMessage,
      );
    if (!retryableModelMiss) {
      break;
    }
  }

  for (const frame of extracted.frames) {
    try {
      unlinkSync(frame);
    } catch {
      // ignore
    }
  }
  try {
    rmSync(dirname(extracted.frames[0]), { recursive: true, force: true });
  } catch {
    // ignore
  }

  if (!response?.ok) {
    const message = lastErrorMessage || "Gemini video analysis failed.";
    throw new Error(message);
  }

  const text = sanitizeVideoAnalysisText(extractTextFromGemini(payload));
  if (!text) {
    throw new Error("Gemini returned an empty video analysis.");
  }

  return {
    text,
    durationSec: extracted.durationSec,
    width: extracted.width,
    height: extracted.height,
    model: chosenModel,
    provider: baseUrl.includes("googleapis.com")
      ? "gemini"
      : "gemini-compatible",
  };
};

const audioTranscribeTextManifest: ToolManifest = {
  id: "audio.transcribe_text",
  name: "Audio Transcribe Text",
  description:
    "Transcribe a recorded audio note with Volcengine ASR and return the plain transcript for text-file delivery.",
  category: "audio",
  tags: ["audio", "recording", "transcribe", "transcript", "voice note", "asr"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Recorded audio file URL",
      accept: [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"],
    },
    {
      name: "language",
      type: "string",
      required: false,
      description: "BCP-47 language code for ASR, defaults to zh-CN",
    },
  ],
  output_type: "json",
  keywords: ["transcribe", "transcript", "speech to text", "voice note text"],
  patterns: ["audio.*transcribe", "audio.*transcript", "voice.*text"],
};

const audioTranscribeTextHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const audioUrl = clean(params.file_url);
  if (!audioUrl) {
    return fail("BAD_REQUEST", "Missing audio file URL.", start);
  }

  const ext =
    extname(new URL(audioUrl, "http://127.0.0.1").pathname).replace(
      /^\./,
      "",
    ) || "wav";
  const localAudioPath = join(
    tmpdir(),
    `omni-capture-audio-${randomUUID()}.${ext}`,
  );
  let normalizedAudioPath;
  try {
    writeFileSync(localAudioPath, await downloadFile(audioUrl));
    normalizedAudioPath = await normalizeAudioForAsr(localAudioPath);
    const transcription = await transcribeWithVolcengine(
      normalizedAudioPath,
      clean(params.language) || "zh-CN",
    );
    const transcript = transcription.text.trim();
    return ok(
      {
        tool: "audio.transcribe_text",
        text: transcript || "Transcript was empty.",
        transcript,
        duration_ms: transcription.durationMs,
        provider: transcription.provider,
        utterances: transcription.utterances,
        source_file_name: basename(localAudioPath),
      },
      start,
    );
  } catch (error) {
    return fail(
      "AUDIO_CAPTURE_TRANSCRIBE_FAILED",
      error instanceof Error ? error.message : String(error),
      start,
    );
  } finally {
    try {
      unlinkSync(localAudioPath);
    } catch {
      // ignore
    }
    if (normalizedAudioPath) {
      try {
        unlinkSync(normalizedAudioPath);
      } catch {
        // ignore
      }
    }
  }
};

export const audioTranscribeText: ToolRegistryEntry = {
  manifest: audioTranscribeTextManifest,
  handler: audioTranscribeTextHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

const audioTranscribeSummaryManifest: ToolManifest = {
  id: "audio.transcribe_summary",
  name: "Audio Transcribe Summary",
  description:
    "Transcribe a recorded audio note with Volcengine ASR and return an AI summary.",
  category: "audio",
  tags: ["audio", "recording", "transcribe", "summary", "voice note", "asr"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Recorded audio file URL",
      accept: [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"],
    },
    {
      name: "language",
      type: "string",
      required: false,
      description: "BCP-47 language code for ASR, defaults to zh-CN",
    },
    {
      name: "note_hint",
      type: "string",
      required: false,
      description: "Optional user hint to bias the final summary",
    },
  ],
  output_type: "json",
  keywords: [
    "transcribe",
    "voice note",
    "audio summary",
    "meeting note",
    "录音总结",
    "语音转文字",
  ],
  patterns: ["audio.*summary", "voice.*note", "录音.*总结", "语音.*转文字"],
};

const audioTranscribeSummaryHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const audioUrl = clean(params.file_url);
  if (!audioUrl) {
    return fail("BAD_REQUEST", "Missing audio file URL.", start);
  }

  const ext =
    extname(new URL(audioUrl, "http://127.0.0.1").pathname).replace(
      /^\./,
      "",
    ) || "wav";
  const localAudioPath = join(
    tmpdir(),
    `omni-capture-audio-${randomUUID()}.${ext}`,
  );
  let normalizedAudioPath;
  try {
    writeFileSync(localAudioPath, await downloadFile(audioUrl));
    normalizedAudioPath = await normalizeAudioForAsr(localAudioPath);
    const transcription = await transcribeWithVolcengine(
      normalizedAudioPath,
      clean(params.language) || "zh-CN",
    );
    const transcript = transcription.text.trim();
    const noteHint = clean(params.note_hint);
    const summary = await summarizeCapturedText("audio", transcript, noteHint);
    const reportMarkdown = buildCaptureReportMarkdown("audio", {
      summary,
      transcript,
      contextHint: noteHint,
      provider: transcription.provider,
      durationMs: transcription.durationMs,
      sourceFileName: basename(localAudioPath),
    });
    return ok(
      {
        tool: "audio.transcribe_summary",
        transcript,
        summary,
        report_markdown: reportMarkdown,
        duration_ms: transcription.durationMs,
        provider: transcription.provider,
        utterances: transcription.utterances,
        source_file_name: basename(localAudioPath),
      },
      start,
    );
  } catch (error) {
    return fail(
      "AUDIO_CAPTURE_ANALYSIS_FAILED",
      error instanceof Error ? error.message : String(error),
      start,
    );
  } finally {
    try {
      unlinkSync(localAudioPath);
    } catch {
      // ignore
    }
    if (normalizedAudioPath) {
      try {
        unlinkSync(normalizedAudioPath);
      } catch {
        // ignore
      }
    }
  }
};

export const audioTranscribeSummary: ToolRegistryEntry = {
  manifest: audioTranscribeSummaryManifest,
  handler: audioTranscribeSummaryHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

const videoTranscribeSubtitleManifest: ToolManifest = {
  id: "video.transcribe_subtitle",
  name: "Video Transcribe Subtitle",
  description:
    "Transcribe a local video file into transcript, TXT, SRT, and VTT subtitles with one call.",
  category: "video",
  tags: [
    "video",
    "subtitle",
    "caption",
    "transcribe",
    "srt",
    "vtt",
    "transcript",
  ],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Uploaded local video file URL",
      accept: [".mp4", ".mov", ".avi", ".mkv", ".webm"],
    },
    {
      name: "language",
      type: "string",
      required: false,
      description: "BCP-47 language code for ASR, defaults to zh-CN",
    },
  ],
  output_type: "json",
  keywords: [
    "video subtitle",
    "video transcript",
    "caption",
    "srt",
    "vtt",
    "字幕",
    "提取字幕",
    "视频转字幕",
    "视频字幕",
  ],
  patterns: [
    "video.*subtitle",
    "video.*caption",
    "video.*transcript",
    "字幕.*视频",
    "视频.*字幕",
    "视频.*转字幕",
  ],
};

const videoTranscribeSubtitleHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const videoUrl = clean(params.file_url);
  if (!videoUrl) {
    return fail("BAD_REQUEST", "Missing video file URL.", start);
  }

  const ext =
    extname(new URL(videoUrl, "http://127.0.0.1").pathname).replace(
      /^\./,
      "",
    ) || "mp4";
  const localVideoPath = join(
    tmpdir(),
    `omni-video-subtitle-${randomUUID()}.${ext}`,
  );
  const extractedAudioPath = join(
    tmpdir(),
    `omni-video-subtitle-audio-${randomUUID()}.wav`,
  );
  let normalizedAudioPath: string | undefined;
  try {
    writeFileSync(localVideoPath, await downloadFile(videoUrl));
    const extractAudioResult = await runCommand(
      ffmpegBin(),
      [
        "-y",
        "-i",
        localVideoPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-sample_fmt",
        "s16",
        extractedAudioPath,
      ],
      180_000,
    );
    if (extractAudioResult.exitCode !== 0) {
      throw new Error(
        extractAudioResult.stderr || "Failed to extract audio from video.",
      );
    }

    normalizedAudioPath = await normalizeAudioForAsr(extractedAudioPath);
    const transcription = await transcribeWithVolcengine(
      normalizedAudioPath,
      clean(params.language) || "zh-CN",
    );
    const transcript = transcription.text.trim();
    const subtitles = buildSubtitleTexts(
      transcript,
      transcription.utterances,
      transcription.durationMs,
    );
    const baseName = sanitizeArtifactBasename(
      basename(localVideoPath),
      "video-subtitles",
    );
    const textFileName = `${baseName}.txt`;
    const srtFileName = `${baseName}.srt`;
    const vttFileName = `${baseName}.vtt`;
    const bundle = createZipBundle(baseName, [
      { name: textFileName, contents: subtitles.txtText },
      { name: srtFileName, contents: subtitles.srtText },
      { name: vttFileName, contents: subtitles.vttText },
    ]);

    return {
      status: "success",
      output: {
        tool: "video.transcribe_subtitle",
        text: transcript || "Transcript was empty.",
        transcript,
        txt_text: subtitles.txtText,
        srt_text: subtitles.srtText,
        vtt_text: subtitles.vttText,
        segments: subtitles.segments,
        duration_ms: transcription.durationMs,
        provider: transcription.provider,
        utterances: transcription.utterances,
        source_file_name: basename(localVideoPath),
        subtitle_bundle_file_name: bundle.fileName,
        artifacts: [
          {
            kind: "txt",
            file_name: textFileName,
            mime_type: subtitleMimeType("txt"),
          },
          {
            kind: "srt",
            file_name: srtFileName,
            mime_type: subtitleMimeType("srt"),
          },
          {
            kind: "vtt",
            file_name: vttFileName,
            mime_type: subtitleMimeType("vtt"),
          },
          {
            kind: "bundle",
            file_name: bundle.fileName,
            mime_type: subtitleMimeType("zip"),
          },
        ],
      },
      output_url: bundle.path,
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return fail(
      "VIDEO_SUBTITLE_TRANSCRIBE_FAILED",
      error instanceof Error ? error.message : String(error),
      start,
    );
  } finally {
    try {
      unlinkSync(localVideoPath);
    } catch {
      // ignore
    }
    try {
      unlinkSync(extractedAudioPath);
    } catch {
      // ignore
    }
    if (normalizedAudioPath) {
      try {
        unlinkSync(normalizedAudioPath);
      } catch {
        // ignore
      }
    }
  }
};

export const videoTranscribeSubtitle: ToolRegistryEntry = {
  manifest: videoTranscribeSubtitleManifest,
  handler: videoTranscribeSubtitleHandler,
  timeout: LONG_TIMEOUT_MS * 3,
};

const videoAnalyzeSummaryManifest: ToolManifest = {
  id: "video.analyze_summary",
  name: "Video Analyze Summary",
  description:
    "Analyze a recorded screen video with Gemini-compatible vision reasoning and return a concise summary.",
  category: "video",
  tags: ["video", "screen recording", "analysis", "summary", "gemini"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Recorded screen video URL",
      accept: [".mp4", ".mov", ".avi", ".mkv", ".webm"],
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional user hint about what to focus on in the recording",
    },
  ],
  output_type: "json",
  keywords: [
    "screen recording",
    "video summary",
    "screen analyze",
    "录屏总结",
    "视频分析",
  ],
  patterns: ["screen.*record", "video.*summary", "录屏.*总结", "视频.*分析"],
};

const videoAnalyzeSummaryHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const videoUrl = clean(params.file_url);
  if (!videoUrl) {
    return fail("BAD_REQUEST", "Missing video file URL.", start);
  }

  const ext =
    extname(new URL(videoUrl, "http://127.0.0.1").pathname).replace(
      /^\./,
      "",
    ) || "mp4";
  const localVideoPath = join(
    tmpdir(),
    `omni-capture-video-${randomUUID()}.${ext}`,
  );
  try {
    writeFileSync(localVideoPath, await downloadFile(videoUrl));
    const analysis = await analyzeVideoWithGemini(
      localVideoPath,
      clean(params.prompt),
    );
    const summary = await summarizeCapturedText(
      "video",
      analysis.text,
      clean(params.prompt),
    );
    const reportMarkdown = buildCaptureReportMarkdown("video", {
      summary,
      analysis: analysis.text,
      contextHint: clean(params.prompt),
      provider: analysis.provider,
      model: analysis.model,
      durationSeconds: analysis.durationSec,
      sourceFileName: basename(localVideoPath),
    });
    return ok(
      {
        tool: "video.analyze_summary",
        analysis: analysis.text,
        summary,
        report_markdown: reportMarkdown,
        provider: analysis.provider,
        model: analysis.model,
        duration_seconds: analysis.durationSec,
        width: analysis.width,
        height: analysis.height,
        source_file_name: basename(localVideoPath),
      },
      start,
    );
  } catch (error) {
    return fail(
      "VIDEO_CAPTURE_ANALYSIS_FAILED",
      error instanceof Error ? error.message : String(error),
      start,
    );
  } finally {
    try {
      unlinkSync(localVideoPath);
    } catch {
      // ignore
    }
  }
};

export const videoAnalyzeSummary: ToolRegistryEntry = {
  manifest: videoAnalyzeSummaryManifest,
  handler: videoAnalyzeSummaryHandler,
  timeout: LONG_TIMEOUT_MS * 3,
};
