// @input: Audio file URLs and processing params
// @output: ToolRegistryEntry objects for 4 audio tools
// @position: Audio processing tools using ffmpeg

import { writeFileSync, unlinkSync } from "node:fs";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { downloadFile, tempFile, runCommand, sanitizeStderr } from "./helpers";

const ffmpeg = "ffmpeg";

/* ── audio.convert ── */

const audioConvertManifest: ToolManifest = {
  id: "audio.convert",
  name: "Audio Convert",
  description: "Convert audio between mp3, wav, flac, aac formats",
  category: "audio",
  tags: ["audio", "convert", "format", "mp3", "wav", "flac", "aac"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Audio file URL", accept: [".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg"] },
    { name: "format", type: "enum", required: true, description: "Target format", enum_values: ["mp3", "wav", "flac", "aac"] },
  ],
  output_type: "file",
  keywords: ["convert", "audio", "format", "mp3", "wav", "flac", "转换", "音频格式"],
  patterns: ["convert.*audio", "audio.*to.*(mp3|wav|flac|aac)", "音频.*转.*格式"],
};

const audioConvertHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const format = (params.format as string ?? "mp3").toLowerCase();
  const codecMap: Record<string, string> = { mp3: "libmp3lame", wav: "pcm_s16le", flac: "flac", aac: "aac" };
  const codec = codecMap[format] ?? "libmp3lame";
  const input = tempFile("audio");
  const output = tempFile(format);
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, ["-i", input, "-acodec", codec, "-y", output]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { format }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const audioConvert: ToolRegistryEntry = { manifest: audioConvertManifest, handler: audioConvertHandler, timeout: LONG_TIMEOUT_MS };

/* ── audio.trim ── */

const audioTrimManifest: ToolManifest = {
  id: "audio.trim",
  name: "Audio Trim",
  description: "Trim audio by start and end timestamps",
  category: "audio",
  tags: ["audio", "trim", "cut", "clip", "time"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Audio file URL", accept: [".mp3", ".wav", ".flac", ".aac", ".m4a"] },
    { name: "start", type: "string", required: true, description: "Start timestamp e.g. '00:00:05' or '5'" },
    { name: "end", type: "string", required: true, description: "End timestamp e.g. '00:01:30' or '90'" },
  ],
  output_type: "file",
  keywords: ["trim", "cut", "audio", "clip", "剪切", "音频剪切", "裁剪音频"],
  patterns: ["trim.*audio", "audio.*trim", "cut.*audio", "剪切.*音频", "音频.*剪"],
};

const audioTrimHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const startTs = params.start as string;
  const endTs = params.end as string;
  const input = tempFile("audio");
  const output = tempFile("mp3");
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, [
      "-i", input, "-ss", startTs, "-to", endTs,
      "-acodec", "libmp3lame", "-y", output,
    ]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { start: startTs, end: endTs }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const audioTrim: ToolRegistryEntry = { manifest: audioTrimManifest, handler: audioTrimHandler, timeout: LONG_TIMEOUT_MS };

/* ── audio.compress ── */

const audioCompressManifest: ToolManifest = {
  id: "audio.compress",
  name: "Audio Compress",
  description: "Compress audio by lowering bitrate",
  category: "audio",
  tags: ["audio", "compress", "bitrate", "reduce", "size"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Audio file URL", accept: [".mp3", ".wav", ".flac", ".aac", ".m4a"] },
    { name: "bitrate", type: "number", required: false, default: 128, description: "Target bitrate in kbps", min: 32, max: 320 },
  ],
  output_type: "file",
  keywords: ["compress", "audio", "bitrate", "reduce", "smaller", "压缩", "音频压缩"],
  patterns: ["compress.*audio", "audio.*compress", "压缩.*音频", "音频.*小"],
};

const audioCompressHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const bitrate = Math.max(32, Math.min(320, Number(params.bitrate ?? 128)));
  const input = tempFile("audio");
  const output = tempFile("mp3");
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, [
      "-i", input, "-acodec", "libmp3lame", "-b:a", `${bitrate}k`, "-y", output,
    ]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { bitrate_kbps: bitrate }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const audioCompress: ToolRegistryEntry = { manifest: audioCompressManifest, handler: audioCompressHandler, timeout: LONG_TIMEOUT_MS };

/* ── audio.normalize ── */

const audioNormalizeManifest: ToolManifest = {
  id: "audio.normalize",
  name: "Audio Normalize",
  description: "Normalize audio volume using loudnorm filter",
  category: "audio",
  tags: ["audio", "normalize", "volume", "loudness", "level"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Audio file URL", accept: [".mp3", ".wav", ".flac", ".aac", ".m4a"] },
    { name: "target_lufs", type: "number", required: false, default: -14, description: "Target loudness in LUFS (e.g. -14 for streaming)", min: -70, max: 0 },
  ],
  output_type: "file",
  keywords: ["normalize", "volume", "audio", "loudness", "level", "音量", "音频均衡"],
  patterns: ["normalize.*audio", "audio.*volume", "均衡.*音量", "音频.*音量"],
};

const audioNormalizeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const targetLufs = Math.max(-70, Math.min(0, Number(params.target_lufs ?? -14)));
  const input = tempFile("audio");
  const output = tempFile("mp3");
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, [
      "-i", input,
      "-af", `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`,
      "-acodec", "libmp3lame", "-y", output,
    ]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { target_lufs: targetLufs }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const audioNormalize: ToolRegistryEntry = { manifest: audioNormalizeManifest, handler: audioNormalizeHandler, timeout: LONG_TIMEOUT_MS };
