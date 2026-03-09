// @input: Video file URLs and processing params
// @output: ToolRegistryEntry objects for 5 video tools
// @position: Video processing tools using ffmpeg

import { writeFileSync, unlinkSync } from "node:fs";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { downloadFile, tempFile, runCommand, sanitizeStderr } from "./helpers";

const ffmpeg = "ffmpeg";

/* ── video.compress ── */

const videoCompressManifest: ToolManifest = {
  id: "video.compress",
  name: "Video Compress",
  description: "Compress video to reduce file size using CRF encoding",
  category: "video",
  tags: ["video", "compress", "reduce", "size", "crf"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Video file URL", accept: [".mp4", ".mov", ".avi", ".mkv"] },
    { name: "crf", type: "number", required: false, default: 28, description: "CRF quality 0-51 (lower=better quality)", min: 0, max: 51 },
  ],
  output_type: "file",
  keywords: ["compress", "video", "reduce", "size", "smaller", "压缩", "视频压缩"],
  patterns: ["compress.*video", "video.*compress", "压缩.*视频", "视频.*小"],
};

const videoCompressHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const crf = Math.max(0, Math.min(51, Number(params.crf ?? 28)));
  const input = tempFile("mp4");
  const output = tempFile("mp4");
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, [
      "-i", input, "-c:v", "libx264", "-crf", String(crf),
      "-c:a", "aac", "-y", output,
    ]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { crf }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const videoCompress: ToolRegistryEntry = { manifest: videoCompressManifest, handler: videoCompressHandler, timeout: LONG_TIMEOUT_MS };

/* ── video.convert ── */

const videoConvertManifest: ToolManifest = {
  id: "video.convert",
  name: "Video Convert",
  description: "Convert video to mp4, webm, or avi format",
  category: "video",
  tags: ["video", "convert", "format", "mp4", "webm", "avi"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Video file URL", accept: [".mp4", ".mov", ".avi", ".mkv", ".webm"] },
    { name: "format", type: "enum", required: true, description: "Target format", enum_values: ["mp4", "webm", "avi"] },
  ],
  output_type: "file",
  keywords: ["convert", "video", "format", "mp4", "webm", "转换", "视频格式"],
  patterns: ["convert.*video", "video.*to.*(mp4|webm|avi)", "视频.*转.*格式"],
};

const videoConvertHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const format = (params.format as string ?? "mp4").toLowerCase();
  const input = tempFile("mp4");
  const output = tempFile(format);
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, ["-i", input, "-y", output]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { format }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const videoConvert: ToolRegistryEntry = { manifest: videoConvertManifest, handler: videoConvertHandler, timeout: LONG_TIMEOUT_MS };

/* ── video.trim ── */

const videoTrimManifest: ToolManifest = {
  id: "video.trim",
  name: "Video Trim",
  description: "Trim video by start and end timestamps",
  category: "video",
  tags: ["video", "trim", "cut", "clip", "time"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Video file URL", accept: [".mp4", ".mov", ".avi", ".mkv"] },
    { name: "start", type: "string", required: true, description: "Start timestamp e.g. '00:00:05' or '5'" },
    { name: "end", type: "string", required: true, description: "End timestamp e.g. '00:01:30' or '90'" },
  ],
  output_type: "file",
  keywords: ["trim", "cut", "video", "clip", "剪切", "视频剪切", "裁剪视频"],
  patterns: ["trim.*video", "video.*trim", "cut.*video", "剪切.*视频", "视频.*剪"],
};

const videoTrimHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const startTs = params.start as string;
  const endTs = params.end as string;
  const input = tempFile("mp4");
  const output = tempFile("mp4");
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, [
      "-i", input, "-ss", startTs, "-to", endTs,
      "-c", "copy", "-y", output,
    ]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { start: startTs, end: endTs }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const videoTrim: ToolRegistryEntry = { manifest: videoTrimManifest, handler: videoTrimHandler, timeout: LONG_TIMEOUT_MS };

/* ── video.to_gif ── */

const videoToGifManifest: ToolManifest = {
  id: "video.to_gif",
  name: "Video to GIF",
  description: "Convert video segment to animated GIF",
  category: "video",
  tags: ["video", "gif", "animate", "convert"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Video file URL", accept: [".mp4", ".mov", ".avi"] },
    { name: "fps", type: "number", required: false, default: 10, description: "GIF frames per second", min: 1, max: 30 },
    { name: "width", type: "number", required: false, default: 480, description: "GIF width in pixels", min: 50, max: 1920 },
  ],
  output_type: "file",
  keywords: ["gif", "video", "animate", "convert", "转gif", "视频转gif"],
  patterns: ["video.*gif", "gif.*video", "视频.*gif", "转.*gif"],
};

const videoToGifHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fps = Math.max(1, Math.min(30, Number(params.fps ?? 10)));
  const width = Math.max(50, Math.min(1920, Number(params.width ?? 480)));
  const input = tempFile("mp4");
  const output = tempFile("gif");
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, [
      "-i", input,
      "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos`,
      "-y", output,
    ]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { fps, width }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const videoToGif: ToolRegistryEntry = { manifest: videoToGifManifest, handler: videoToGifHandler, timeout: LONG_TIMEOUT_MS };

/* ── video.extract_audio ── */

const videoExtractAudioManifest: ToolManifest = {
  id: "video.extract_audio",
  name: "Video Extract Audio",
  description: "Extract audio track from video file",
  category: "video",
  tags: ["video", "audio", "extract", "mp3", "sound"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Video file URL", accept: [".mp4", ".mov", ".avi", ".mkv"] },
    { name: "format", type: "enum", required: false, default: "mp3", description: "Audio output format", enum_values: ["mp3", "aac", "wav"] },
  ],
  output_type: "file",
  keywords: ["extract", "audio", "video", "sound", "mp3", "提取音频", "视频提取音频"],
  patterns: ["extract.*audio", "video.*audio", "提取.*音频", "视频.*音频"],
};

const videoExtractAudioHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const format = (params.format as string ?? "mp3").toLowerCase();
  const input = tempFile("mp4");
  const output = tempFile(format);
  try {
    writeFileSync(input, await downloadFile(params.file_url as string));
    const result = await runCommand(ffmpeg, [
      "-i", input, "-vn", "-acodec", format === "mp3" ? "libmp3lame" : format,
      "-y", output,
    ]);
    if (result.exitCode !== 0) throw new Error(sanitizeStderr(result.stderr));
    return { status: "success", output_url: output, output: { format }, duration_ms: Date.now() - start };
  } catch (err) {
    return { status: "failed", error: { code: "ffmpeg_error", message: (err as Error).message }, duration_ms: Date.now() - start };
  } finally {
    try { unlinkSync(input); } catch { /* ok */ }
  }
};

export const videoExtractAudio: ToolRegistryEntry = { manifest: videoExtractAudioManifest, handler: videoExtractAudioHandler, timeout: LONG_TIMEOUT_MS };
