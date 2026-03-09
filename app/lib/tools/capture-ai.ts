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

const inferAudioFormat = (filePath: string): string => {
  const ext = extname(filePath).replace(/^\./, "").toLowerCase();
  if (ext === "m4a") return "mp4";
  return ext || "wav";
};

const normalizeAudioForAsr = async (sourcePath: string): Promise<string> => {
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

const transcribeWithVolcengine = async (
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
