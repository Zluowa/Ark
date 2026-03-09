
// @input: image URLs, transform params, optional multi-file arrays
// @output: tool registry entries for image transforms, enhancement, and watermark cleanup
// @position: Sharp-powered image processing tools with AI fallback where needed

import { copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { downloadFile, runCommand, tempFile } from "./helpers";
import { generateImage } from "./image-gen";

type SharpFormat = "jpeg" | "png" | "webp" | "avif";
export type WatermarkPlacement = "auto" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
type ProcessingMode = "auto" | "traditional" | "ai";

type ImageSuccessMeta = {
  filename?: string;
  name?: string;
  format?: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  original_size?: number;
  compressed_size?: number;
  compression_ratio?: number;
  strategy?: string;
  detail_text?: string;
  count?: number;
  processed_count?: number;
  failed_count?: number;
  items?: Array<Record<string, unknown>>;
  output_files?: string[];
  [key: string]: unknown;
};

type RawImage = { width: number; height: number; channels: number; data: Uint8Array };
export type DetectionCandidate = {
  placement: Exclude<WatermarkPlacement, "auto">;
  mask: Uint8Array;
  bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  confidence: number;
  coverage: number;
};

const FORMAT_MAP: Record<string, SharpFormat> = { jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", avif: "avif" };
const WATERMARK_PROMPT = "Remove the watermark from this image. Preserve the exact subject, colors, framing, composition, and style. Do not crop. Do not add text, logos, or extra objects.";
const UPSCALE_PROMPT = "Upscale and enhance this image. Preserve the exact subject, framing, colors, and composition. Improve clarity and detail without adding new objects, text, or watermark.";

const ok = (data: ImageSuccessMeta, outputUrl: string, start: number): ReturnType<ToolHandler> => Promise.resolve({ status: "success", output: data, output_url: outputUrl, duration_ms: Date.now() - start });
const fail = (code: string, message: string, start: number): ReturnType<ToolHandler> => Promise.resolve({ status: "failed", error: { code, message }, duration_ms: Date.now() - start });
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clean = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const parseNumber = (value: unknown, fallback: number, bounds?: { min?: number; max?: number }): number => {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  const withMin = typeof bounds?.min === "number" ? Math.max(bounds.min, numeric) : numeric;
  return typeof bounds?.max === "number" ? Math.min(bounds.max, withMin) : withMin;
};

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try { return asStringArray(JSON.parse(trimmed)); } catch {}
  }
  return trimmed.split(/[\n,]/g).map((item) => item.trim()).filter(Boolean);
};

const normalizeFormat = (value: string, fallback: SharpFormat): SharpFormat => FORMAT_MAP[value.toLowerCase()] ?? fallback;
const formatExt = (format: SharpFormat): string => format === "jpeg" ? "jpg" : format;
const bytesLabel = (value: number | undefined): string => !value || value <= 0 ? "" : value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;

export const normalizePlacement = (value: unknown): WatermarkPlacement => {
  const input = clean(value).toLowerCase();
  if (!input) return "auto";
  if (input.includes("top-left") || input.includes("upper-left") || input.includes("left top") || input.includes("左上")) return "top-left";
  if (input.includes("top-right") || input.includes("upper-right") || input.includes("right top") || input.includes("右上")) return "top-right";
  if (input.includes("bottom-left") || input.includes("lower-left") || input.includes("left bottom") || input.includes("左下")) return "bottom-left";
  if (input.includes("bottom-right") || input.includes("lower-right") || input.includes("right bottom") || input.includes("右下")) return "bottom-right";
  return "auto";
};

const normalizeMode = (value: unknown): ProcessingMode => {
  const input = clean(value).toLowerCase();
  if (input === "traditional") return "traditional";
  if (input === "ai") return "ai";
  return "auto";
};

const filenameFromUrl = (url: string, fallback: string): string => {
  try { const parsed = new URL(url); return basename(parsed.pathname) || fallback; } catch { return basename(url) || fallback; }
};

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));
const parseFileUrls = (params: Record<string, unknown>, key = "file_url"): string[] => uniqueStrings([clean(params[key]), clean(params.file_url), clean(params.url), ...asStringArray(params.file_urls), ...asStringArray(params.fileUrls), ...asStringArray(params.urls)].filter(Boolean));

const buildImageOutput = (filePath: string, meta: ImageSuccessMeta, originalName: string): ImageSuccessMeta => {
  const ext = extname(filePath).replace(/^\./, "").toLowerCase();
  const stats = statSync(filePath);
  return {
    filename: meta.filename ?? `${originalName.replace(/\.[^.]+$/, "") || "image"}.${ext || "png"}`,
    name: meta.name ?? originalName,
    format: meta.format ?? ext,
    size_bytes: meta.size_bytes ?? stats.size,
    ...meta,
  };
};

const saveWithFormat = async (buffer: Buffer, format: SharpFormat, output: string, options: { quality?: number } = {}): Promise<sharp.OutputInfo> => {
  const quality = clamp(options.quality ?? 80, 1, 100);
  const pipeline = sharp(buffer, { failOn: "none" });
  switch (format) {
    case "jpeg": return pipeline.jpeg({ quality, mozjpeg: true }).toFile(output);
    case "png": return pipeline.png({ compressionLevel: 9 }).toFile(output);
    case "webp": return pipeline.webp({ quality }).toFile(output);
    case "avif": return pipeline.avif({ quality }).toFile(output);
  }
};

const readRawImage = async (buffer: Buffer): Promise<RawImage> => {
  const { data, info } = await sharp(buffer, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels };
};

const channelIndex = (width: number, channels: number, x: number, y: number): number => (y * width + x) * channels;
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const saturation = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b);
const cloneMask = (mask: Uint8Array): Uint8Array => new Uint8Array(mask);
const dilateMask = (mask: Uint8Array, width: number, height: number, radius: number): Uint8Array => {
  let current = cloneMask(mask);
  for (let step = 0; step < radius; step += 1) {
    const next = cloneMask(current);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        if (current[idx]) continue;
        for (let oy = -1; oy <= 1; oy += 1) {
          let found = false;
          for (let ox = -1; ox <= 1; ox += 1) {
            if (current[(y + oy) * width + (x + ox)]) {
              next[idx] = 1;
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
    }
    current = next;
  }
  return current;
};

const removeIsolatedPixels = (mask: Uint8Array, width: number, height: number): Uint8Array => {
  const next = cloneMask(mask);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      let neighbors = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          neighbors += mask[(y + oy) * width + (x + ox)];
        }
      }
      if (neighbors < 2) next[idx] = 0;
    }
  }
  return next;
};

const maskBounds = (mask: Uint8Array, width: number, height: number): DetectionCandidate["bounds"] | undefined => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return undefined;
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
};

const buildCornerMask = async (buffer: Buffer, placement: Exclude<WatermarkPlacement, "auto">): Promise<DetectionCandidate | undefined> => {
  const raw = await readRawImage(buffer);
  const blurred = await readRawImage(await sharp(buffer, { failOn: "none" }).ensureAlpha().blur(12).png().toBuffer());
  const bandWidth = clamp(Math.round(raw.width * 0.42), 120, 360);
  const bandHeight = clamp(Math.round(raw.height * 0.12), 28, 120);
  const x0 = placement.includes("right") ? raw.width - bandWidth : 0;
  const y0 = placement.includes("bottom") ? raw.height - bandHeight : 0;
  const mask = new Uint8Array(raw.width * raw.height);
  let diffTotal = 0;
  let samples = 0;
  let neutralLightSamples = 0;

  for (let y = y0; y < y0 + bandHeight; y += 1) {
    for (let x = x0; x < x0 + bandWidth; x += 1) {
      const idx = channelIndex(raw.width, raw.channels, x, y);
      diffTotal += Math.abs(luma(raw.data[idx], raw.data[idx + 1], raw.data[idx + 2]) - luma(blurred.data[idx], blurred.data[idx + 1], blurred.data[idx + 2]));
      samples += 1;
    }
  }

  const diffThreshold = Math.max(20, (diffTotal / Math.max(1, samples)) * 1.85);
  let candidateCount = 0;
  for (let y = y0; y < y0 + bandHeight; y += 1) {
    for (let x = x0; x < x0 + bandWidth; x += 1) {
      const rgba = channelIndex(raw.width, raw.channels, x, y);
      const r = raw.data[rgba];
      const g = raw.data[rgba + 1];
      const b = raw.data[rgba + 2];
      const a = raw.data[rgba + 3];
      const diff = Math.abs(luma(r, g, b) - luma(blurred.data[rgba], blurred.data[rgba + 1], blurred.data[rgba + 2]));
      const sat = saturation(r, g, b);
      const lightness = luma(r, g, b);
      const likely =
        a > 24 &&
        diff >= diffThreshold &&
        (
          (lightness >= 148 && sat <= 72) ||
          lightness >= 192 ||
          (lightness <= 84 && sat <= 48)
        );
      if (!likely) continue;
      mask[y * raw.width + x] = 1;
      candidateCount += 1;
      if ((lightness >= 148 && sat <= 72) || lightness >= 192) {
        neutralLightSamples += 1;
      }
    }
  }

  if (candidateCount < 12) return undefined;
  const cleaned = dilateMask(removeIsolatedPixels(mask, raw.width, raw.height), raw.width, raw.height, 4);
  const bounds = maskBounds(cleaned, raw.width, raw.height);
  if (!bounds) return undefined;
  const coverage = candidateCount / Math.max(1, bandWidth * bandHeight);
  if (coverage < 0.001 || coverage > 0.22) return undefined;
  const touchesExpectedEdges = (placement.includes("left") ? bounds.left <= 18 : bounds.right >= raw.width - 19) && (placement.includes("top") ? bounds.top <= 18 : bounds.bottom >= raw.height - 19);
  if (!touchesExpectedEdges) return undefined;
  const neutralRatio = neutralLightSamples / Math.max(1, candidateCount);
  const aspectRatio = bounds.width / Math.max(1, bounds.height);
  const shapeScore = clamp((aspectRatio - 1.1) / 3.4, 0, 1);
  const confidence = clamp(
    0.34 +
      (Math.min(bounds.width, bandWidth) / bandWidth) * 0.08 +
      (Math.min(bounds.height, bandHeight) / bandHeight) * 0.05 +
      neutralRatio * 0.26 +
      shapeScore * 0.24 +
      (touchesExpectedEdges ? 0.18 : 0) -
      coverage * 0.34,
    0,
    0.98,
  );
  return { placement, mask: cleaned, bounds, coverage, confidence };
};

const buildFallbackCornerMask = async (buffer: Buffer, placement: Exclude<WatermarkPlacement, "auto">): Promise<DetectionCandidate> => {
  const raw = await readRawImage(buffer);
  const boxWidth = clamp(Math.round(raw.width * 0.42), 140, 340);
  const boxHeight = clamp(Math.round(raw.height * 0.09), 28, 72);
  const x0 = placement.includes("right") ? raw.width - boxWidth : 0;
  const y0 = placement.includes("bottom") ? raw.height - boxHeight : 0;
  const mask = new Uint8Array(raw.width * raw.height);

  for (let y = y0; y < Math.min(raw.height, y0 + boxHeight); y += 1) {
    for (let x = x0; x < Math.min(raw.width, x0 + boxWidth); x += 1) {
      mask[y * raw.width + x] = 1;
    }
  }

  const bounds = {
    left: x0,
    top: y0,
    right: Math.min(raw.width - 1, x0 + boxWidth - 1),
    bottom: Math.min(raw.height - 1, y0 + boxHeight - 1),
    width: Math.min(raw.width, boxWidth),
    height: Math.min(raw.height, boxHeight),
  };

  return {
    placement,
    mask,
    bounds,
    coverage: (bounds.width * bounds.height) / Math.max(1, raw.width * raw.height),
    confidence: 0.5,
  };
};

const measureCornerActivity = async (buffer: Buffer, placement: Exclude<WatermarkPlacement, "auto">): Promise<number> => {
  const raw = await readRawImage(buffer);
  const blurred = await readRawImage(await sharp(buffer, { failOn: "none" }).ensureAlpha().blur(12).png().toBuffer());
  const boxWidth = clamp(Math.round(raw.width * 0.42), 140, 340);
  const boxHeight = clamp(Math.round(raw.height * 0.09), 28, 72);
  const x0 = placement.includes("right") ? raw.width - boxWidth : 0;
  const y0 = placement.includes("bottom") ? raw.height - boxHeight : 0;
  let total = 0;
  let samples = 0;

  for (let y = y0; y < Math.min(raw.height, y0 + boxHeight); y += 1) {
    for (let x = x0; x < Math.min(raw.width, x0 + boxWidth); x += 1) {
      const idx = channelIndex(raw.width, raw.channels, x, y);
      total += Math.abs(
        luma(raw.data[idx], raw.data[idx + 1], raw.data[idx + 2]) -
          luma(blurred.data[idx], blurred.data[idx + 1], blurred.data[idx + 2]),
      );
      samples += 1;
    }
  }

  return total / Math.max(1, samples);
};

const measureCornerWatermarkLikelihood = async (
  buffer: Buffer,
  placement: Exclude<WatermarkPlacement, "auto">,
): Promise<number> => {
  const raw = await readRawImage(buffer);
  const boxWidth = clamp(Math.round(raw.width * 0.42), 140, 340);
  const boxHeight = clamp(Math.round(raw.height * 0.09), 28, 72);
  const x0 = placement.includes("right") ? raw.width - boxWidth : 0;
  const y0 = placement.includes("bottom") ? raw.height - boxHeight : 0;
  let brightNeutral = 0;
  let total = 0;
  for (let y = y0; y < Math.min(raw.height, y0 + boxHeight); y += 1) {
    for (let x = x0; x < Math.min(raw.width, x0 + boxWidth); x += 1) {
      const idx = channelIndex(raw.width, raw.channels, x, y);
      const r = raw.data[idx];
      const g = raw.data[idx + 1];
      const b = raw.data[idx + 2];
      const lightness = luma(r, g, b);
      const sat = saturation(r, g, b);
      if ((lightness >= 148 && sat <= 72) || lightness >= 192) {
        brightNeutral += 1;
      }
      total += 1;
    }
  }
  return brightNeutral / Math.max(1, total);
};

export const inferWatermarkPlacement = async (
  buffer: Buffer,
): Promise<Exclude<WatermarkPlacement, "auto">> => {
  const corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
  const scored = await Promise.all(
    corners.map(async (corner) => ({
      corner,
      score:
        (await measureCornerWatermarkLikelihood(buffer, corner)) * 100 +
        (await measureCornerActivity(buffer, corner)) * 0.12,
    })),
  );
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.corner ?? "bottom-right";
};

export const detectWatermarkMask = async (buffer: Buffer, placement: WatermarkPlacement): Promise<DetectionCandidate | undefined> => {
  if (placement !== "auto") {
    return (await buildCornerMask(buffer, placement)) ?? (await buildFallbackCornerMask(buffer, placement));
  }

  const corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
  const cornerScores = await Promise.all(
    corners.map(async (corner) => ({
      corner,
      score: await measureCornerWatermarkLikelihood(buffer, corner),
    })),
  );
  const scoreByCorner = new Map(cornerScores.map((item) => [item.corner, item.score]));
  const candidates = await Promise.all(corners.map((corner) => buildCornerMask(buffer, corner)));
  const heuristic = candidates
    .filter((item): item is DetectionCandidate => Boolean(item))
    .sort((a, b) => {
      const scoreA = a.confidence + (scoreByCorner.get(a.placement) ?? 0) * 2.4;
      const scoreB = b.confidence + (scoreByCorner.get(b.placement) ?? 0) * 2.4;
      return scoreB - scoreA;
    })[0];
  if (heuristic) return heuristic;

  const scored = await Promise.all(
    corners.map(async (corner) => ({
      corner,
      score:
        (await measureCornerActivity(buffer, corner)) * 0.35 +
        (scoreByCorner.get(corner) ?? 0) * 100,
    })),
  );
  scored.sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? 0) < 6) return undefined;
  return buildFallbackCornerMask(buffer, scored[0].corner);
};

const blendMask = async (mask: Uint8Array, width: number, height: number): Promise<Uint8Array> => {
  const alpha = Uint8Array.from(mask, (value) => (value ? 255 : 0));
  const feathered = await sharp(Buffer.from(alpha), { raw: { width, height, channels: 1 } }).blur(6).raw().toBuffer();
  return new Uint8Array(feathered);
};

const buildBackgroundEstimate = async (source: Buffer): Promise<RawImage> => {
  const meta = await sharp(source, { failOn: "none" }).ensureAlpha().metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const coarseWidth = clamp(Math.round(width / 10), 24, width);
  const coarseHeight = clamp(Math.round(height / 10), 24, height);
  const mediumWidth = clamp(Math.round(width / 4), 48, width);
  const mediumHeight = clamp(Math.round(height / 4), 48, height);
  const [coarse, medium] = await Promise.all([
    sharp(source, { failOn: "none" })
      .ensureAlpha()
      .resize({ width: coarseWidth, height: coarseHeight, fit: "fill", kernel: sharp.kernel.cubic })
      .resize({ width, height, fit: "fill", kernel: sharp.kernel.cubic })
      .blur(14)
      .png()
      .toBuffer(),
    sharp(source, { failOn: "none" })
      .ensureAlpha()
      .resize({ width: mediumWidth, height: mediumHeight, fit: "fill", kernel: sharp.kernel.cubic })
      .resize({ width, height, fit: "fill", kernel: sharp.kernel.cubic })
      .blur(8)
      .png()
      .toBuffer(),
  ]);
  const coarseRaw = await readRawImage(coarse);
  const mediumRaw = await readRawImage(medium);
  const out = new Uint8Array(coarseRaw.data.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.round(mediumRaw.data[i] * 0.65 + coarseRaw.data[i] * 0.35);
  }
  return { width, height, channels: coarseRaw.channels, data: out };
};

const measureMaskedDelta = (before: Uint8Array, after: Uint8Array, mask: Uint8Array, width: number, height: number, channels: number): number => {
  let total = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const flat = y * width + x;
      if (!mask[flat]) continue;
      const idx = channelIndex(width, channels, x, y);
      total +=
        Math.abs(before[idx] - after[idx]) +
        Math.abs(before[idx + 1] - after[idx + 1]) +
        Math.abs(before[idx + 2] - after[idx + 2]);
      samples += 3;
    }
  }
  return samples > 0 ? total / samples : 0;
};

const inpaintMask = async (source: Buffer, detection: DetectionCandidate): Promise<Buffer> => {
  const raw = await readRawImage(source);
  const estimate = await buildBackgroundEstimate(source);
  const out = new Uint8Array(raw.data);
  const alpha = await blendMask(detection.mask, raw.width, raw.height);
  const bounds = detection.bounds;
  const topSampleY = clamp(bounds.top - 1, 0, raw.height - 1);
  const bottomSampleY = clamp(bounds.bottom + 1, 0, raw.height - 1);
  const leftSampleX = clamp(bounds.left - 1, 0, raw.width - 1);
  const rightSampleX = clamp(bounds.right + 1, 0, raw.width - 1);

  for (let y = Math.max(0, bounds.top - 14); y <= Math.min(raw.height - 1, bounds.bottom + 14); y += 1) {
    for (let x = Math.max(0, bounds.left - 14); x <= Math.min(raw.width - 1, bounds.right + 14); x += 1) {
      const flat = y * raw.width + x;
      if (!detection.mask[flat]) continue;
      const idx = channelIndex(raw.width, raw.channels, x, y);
      let sampleAx = x;
      let sampleAy = topSampleY;
      let sampleBx = leftSampleX;
      let sampleBy = y;
      switch (detection.placement) {
        case "top-left":
          sampleAx = x;
          sampleAy = bottomSampleY;
          sampleBx = rightSampleX;
          sampleBy = y;
          break;
        case "top-right":
          sampleAx = x;
          sampleAy = bottomSampleY;
          sampleBx = leftSampleX;
          sampleBy = y;
          break;
        case "bottom-left":
          sampleAx = x;
          sampleAy = topSampleY;
          sampleBx = rightSampleX;
          sampleBy = y;
          break;
        case "bottom-right":
          sampleAx = x;
          sampleAy = topSampleY;
          sampleBx = leftSampleX;
          sampleBy = y;
          break;
      }
      const idxA = channelIndex(raw.width, raw.channels, clamp(sampleAx, 0, raw.width - 1), clamp(sampleAy, 0, raw.height - 1));
      const idxB = channelIndex(raw.width, raw.channels, clamp(sampleBx, 0, raw.width - 1), clamp(sampleBy, 0, raw.height - 1));
      const fillR = raw.data[idxA] * 0.58 + raw.data[idxB] * 0.42;
      const fillG = raw.data[idxA + 1] * 0.58 + raw.data[idxB + 1] * 0.42;
      const fillB = raw.data[idxA + 2] * 0.58 + raw.data[idxB + 2] * 0.42;
      const mix = alpha[flat] >= 220 ? 1 : Math.max(0.9, alpha[flat] / 255);
      out[idx] = Math.round(fillR * mix + raw.data[idx] * (1 - mix));
      out[idx + 1] = Math.round(fillG * mix + raw.data[idx + 1] * (1 - mix));
      out[idx + 2] = Math.round(fillB * mix + raw.data[idx + 2] * (1 - mix));
      out[idx + 3] = raw.data[idx + 3];
    }
  }

  if (measureMaskedDelta(raw.data, out, detection.mask, raw.width, raw.height, raw.channels) < 4.5) {
    throw new Error("Traditional cleanup did not materially change the watermark region");
  }

  return sharp(Buffer.from(out), { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toBuffer();
};

const withAiFallback = async (fileUrl: string, prompt: string, start: number, extra: Record<string, unknown>): Promise<ReturnType<ToolHandler>> => {
  const ai = await generateImage.handler({ prompt, reference_image_url: fileUrl, ...extra });
  if (ai.status === "failed") return ai;
  const output = (ai.output ?? {}) as Record<string, unknown>;
  const outputUrl = ai.output_url ?? String(output.output_file_url ?? "");
  return ok({ ...output, strategy: "ai_fallback", detail_text: typeof output.detail_text === "string" && output.detail_text.trim() ? output.detail_text : "AI fallback" }, outputUrl, start);
};

const sanitizeName = (value: string): string => value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");

const createZipArchive = async (files: Array<{ path: string; name: string }>): Promise<string> => {
  const stageDir = mkdtempSync(join(tmpdir(), "omni-image-batch-"));
  const zipPath = tempFile("zip");
  try {
    for (const file of files) copyFileSync(file.path, join(stageDir, sanitizeName(file.name)));
    if (process.platform !== "win32") throw new Error("Batch zip is only configured for Windows in this workspace");
    const command = `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`;
    const result = await runCommand("powershell", ["-NoProfile", "-Command", command], 120_000);
    if (result.exitCode !== 0) throw new Error(result.stderr || "Compress-Archive failed");
    return zipPath;
  } finally {
    rmSync(stageDir, { force: true, recursive: true });
  }
};

const imageCompressManifest: ToolManifest = {
  id: "image.compress",
  name: "Image Compress",
  description: "Compress image size with controllable quality and output format.",
  category: "image",
  tags: ["image", "compress", "reduce", "size", "webp", "jpeg", "avif"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"] },
    { name: "quality", type: "number", required: false, default: 80, description: "Quality from 1 to 100", min: 1, max: 100 },
    { name: "format", type: "enum", required: false, default: "webp", description: "Output format", enum_values: ["webp", "jpg", "png", "avif"] },
  ],
  output_type: "file",
  keywords: ["compress", "image", "photo", "reduce", "smaller", "image compress", "图片压缩", "压缩图片"],
  patterns: ["compress.*image", "image.*compress", "压缩.*图片", "图片.*压缩"],
};

const imageCompressHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  if (!fileUrl) return fail("bad_request", "file_url required", start);
  const quality = clamp(parseNumber(params.quality, 80), 1, 100);
  const format = normalizeFormat(clean(params.format) || "webp", "webp");
  const output = tempFile(formatExt(format));
  const originalName = filenameFromUrl(fileUrl, "image");
  try {
    const input = await downloadFile(fileUrl);
    const info = await saveWithFormat(input, format, output, { quality });
    const compressionRatio = input.length > 0 ? Math.max(0, 1 - info.size / input.length) : 0;
    return ok(buildImageOutput(output, { width: info.width, height: info.height, format: formatExt(format), original_size: input.length, compressed_size: info.size, compression_ratio: compressionRatio, detail_text: `${quality}% quality | ${bytesLabel(info.size)}`.trim() }, originalName), output, start);
  } catch (error) {
    return fail("sharp_error", (error as Error).message, start);
  }
};

export const imageCompress: ToolRegistryEntry = { manifest: imageCompressManifest, handler: imageCompressHandler, timeout: LONG_TIMEOUT_MS };
const imageResizeManifest: ToolManifest = {
  id: "image.resize",
  name: "Image Resize",
  description: "Resize image to target dimensions.",
  category: "image",
  tags: ["image", "resize", "scale", "dimensions"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp"] },
    { name: "width", type: "number", required: false, description: "Target width in pixels", min: 1, max: 10000 },
    { name: "height", type: "number", required: false, description: "Target height in pixels", min: 1, max: 10000 },
    { name: "fit", type: "enum", required: false, default: "inside", description: "Sharp fit mode", enum_values: ["cover", "contain", "fill", "inside", "outside"] },
  ],
  output_type: "file",
  keywords: ["resize", "image", "scale", "dimensions", "缩放图片", "调整图片大小", "图片尺寸"],
  patterns: ["resize.*image", "image.*resize", "缩放.*图片", "图片.*尺寸"],
};

const imageResizeHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const width = params.width ? Math.max(1, Number(params.width)) : undefined;
  const height = params.height ? Math.max(1, Number(params.height)) : undefined;
  const fit = (clean(params.fit) || "inside") as sharp.FitEnum[keyof sharp.FitEnum];
  if (!width && !height) return fail("bad_request", "width or height required", start);
  const fileUrl = clean(params.file_url);
  const output = tempFile("png");
  const originalName = filenameFromUrl(fileUrl, "image");
  try {
    const input = await downloadFile(fileUrl);
    const info = await sharp(input, { failOn: "none" }).resize({ width, height, fit }).png().toFile(output);
    return ok(buildImageOutput(output, { width: info.width, height: info.height, format: "png", detail_text: `${info.width}x${info.height}` }, originalName), output, start);
  } catch (error) {
    return fail("sharp_error", (error as Error).message, start);
  }
};

export const imageResize: ToolRegistryEntry = { manifest: imageResizeManifest, handler: imageResizeHandler, timeout: LONG_TIMEOUT_MS };

const imageCropManifest: ToolManifest = {
  id: "image.crop",
  name: "Image Crop",
  description: "Crop image to the specified rectangle.",
  category: "image",
  tags: ["image", "crop", "cut", "region"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp"] },
    { name: "x", type: "number", required: true, description: "Left offset in pixels", min: 0 },
    { name: "y", type: "number", required: true, description: "Top offset in pixels", min: 0 },
    { name: "width", type: "number", required: true, description: "Crop width in pixels", min: 1 },
    { name: "height", type: "number", required: true, description: "Crop height in pixels", min: 1 },
  ],
  output_type: "file",
  keywords: ["crop", "cut", "image", "region", "裁剪图片", "图片裁剪"],
  patterns: ["crop.*image", "image.*crop", "裁剪.*图片", "图片.*裁剪"],
};

const imageCropHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const x = Math.max(0, Number(params.x));
  const y = Math.max(0, Number(params.y));
  const width = Math.max(1, Number(params.width));
  const height = Math.max(1, Number(params.height));
  const fileUrl = clean(params.file_url);
  const output = tempFile("png");
  const originalName = filenameFromUrl(fileUrl, "image");
  try {
    const input = await downloadFile(fileUrl);
    const info = await sharp(input, { failOn: "none" }).extract({ left: x, top: y, width, height }).png().toFile(output);
    return ok(buildImageOutput(output, { width: info.width, height: info.height, format: "png", detail_text: `${info.width}x${info.height}` }, originalName), output, start);
  } catch (error) {
    return fail("sharp_error", (error as Error).message, start);
  }
};

export const imageCrop: ToolRegistryEntry = { manifest: imageCropManifest, handler: imageCropHandler, timeout: LONG_TIMEOUT_MS };

const imageConvertManifest: ToolManifest = {
  id: "image.convert",
  name: "Image Convert",
  description: "Convert images between PNG, JPG, WebP, and AVIF.",
  category: "image",
  tags: ["image", "convert", "format", "png", "jpg", "webp", "avif"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"] },
    { name: "format", type: "enum", required: true, description: "Target format", enum_values: ["png", "jpg", "webp", "avif"] },
  ],
  output_type: "file",
  keywords: ["convert", "image", "format", "png", "jpg", "webp", "图片格式转换", "转换图片格式"],
  patterns: ["convert.*image", "image.*format", "图片.*格式", "转换.*图片"],
};

const imageConvertHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  const format = normalizeFormat(clean(params.format) || "png", "png");
  const output = tempFile(formatExt(format));
  const originalName = filenameFromUrl(fileUrl, "image");
  try {
    const input = await downloadFile(fileUrl);
    const info = await saveWithFormat(input, format, output, { quality: 90 });
    return ok(buildImageOutput(output, { width: info.width, height: info.height, format: formatExt(format), detail_text: `to ${formatExt(format)}` }, originalName), output, start);
  } catch (error) {
    return fail("sharp_error", (error as Error).message, start);
  }
};

export const imageConvert: ToolRegistryEntry = { manifest: imageConvertManifest, handler: imageConvertHandler, timeout: LONG_TIMEOUT_MS };

const imageRotateManifest: ToolManifest = {
  id: "image.rotate",
  name: "Image Rotate",
  description: "Rotate image by the specified degrees.",
  category: "image",
  tags: ["image", "rotate", "turn", "degrees"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp"] },
    { name: "degrees", type: "number", required: true, description: "Rotation degrees, for example 90, 180, or 270", min: -360, max: 360 },
  ],
  output_type: "file",
  keywords: ["rotate", "turn", "image", "degrees", "旋转图片", "图片旋转"],
  patterns: ["rotate.*image", "image.*rotate", "旋转.*图片", "图片.*旋转"],
};

const imageRotateHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  const degrees = Number(params.degrees ?? 90);
  const output = tempFile("png");
  const originalName = filenameFromUrl(fileUrl, "image");
  try {
    const input = await downloadFile(fileUrl);
    const info = await sharp(input, { failOn: "none" }).rotate(degrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(output);
    return ok(buildImageOutput(output, { width: info.width, height: info.height, format: "png", detail_text: `${degrees}°` }, originalName), output, start);
  } catch (error) {
    return fail("sharp_error", (error as Error).message, start);
  }
};

export const imageRotate: ToolRegistryEntry = { manifest: imageRotateManifest, handler: imageRotateHandler, timeout: LONG_TIMEOUT_MS };

const imageMetadataManifest: ToolManifest = {
  id: "image.metadata",
  name: "Image Metadata",
  description: "Read dimensions, format, color data, and file size.",
  category: "image",
  tags: ["image", "metadata", "info", "dimensions", "format"],
  params: [{ name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"] }],
  output_type: "json",
  keywords: ["metadata", "info", "image", "dimensions", "width", "height", "图片信息", "尺寸"],
  patterns: ["image.*info", "image.*metadata", "image.*dimensions", "图片.*信息", "图片.*尺寸"],
};

const imageMetadataHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  try {
    const input = await downloadFile(fileUrl);
    const meta = await sharp(input, { failOn: "none" }).metadata();
    return { status: "success", output: { format: meta.format, width: meta.width, height: meta.height, channels: meta.channels, space: meta.space, depth: meta.depth, density: meta.density, has_alpha: meta.hasAlpha, file_size: input.length }, duration_ms: Date.now() - start };
  } catch (error) {
    return fail("sharp_error", (error as Error).message, start);
  }
};

export const imageMetadata: ToolRegistryEntry = { manifest: imageMetadataManifest, handler: imageMetadataHandler, timeout: LONG_TIMEOUT_MS };

const imageUpscaleManifest: ToolManifest = {
  id: "image.upscale",
  name: "Image Upscale",
  description: "Upscale an image with sharp first, then fall back to AI only if needed.",
  category: "image",
  tags: ["image", "upscale", "enhance", "hd", "4k", "super-resolution"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"] },
    { name: "scale", type: "number", required: false, default: 2, description: "Scale multiplier", min: 1, max: 4 },
    { name: "mode", type: "enum", required: false, default: "auto", description: "Traditional first, AI only, or automatic fallback", enum_values: ["auto", "traditional", "ai"] },
    { name: "prompt", type: "string", required: false, description: "Optional custom fallback prompt for AI mode" },
  ],
  output_type: "file",
  keywords: ["upscale", "enhance image", "hd image", "4k image", "高清图片", "图片变清晰", "放大图片"],
  patterns: ["upscale.*image", "enhance.*image", "高清.*图片", "图片.*清晰", "放大.*图片"],
};

const imageUpscaleHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  if (!fileUrl) return fail("bad_request", "file_url required", start);
  const scale = clamp(Math.round(parseNumber(params.scale, 2)), 1, 4);
  const mode = normalizeMode(params.mode);
  const originalName = filenameFromUrl(fileUrl, "image");

  if (mode !== "ai") {
    try {
      const input = await downloadFile(fileUrl);
      const meta = await sharp(input, { failOn: "none" }).metadata();
      if (!meta.width || !meta.height) throw new Error("Unable to read image dimensions");
      const output = tempFile("png");
      const info = await sharp(input, { failOn: "none" })
        .resize({ width: clamp(Math.round(meta.width * scale), 1, 8192), height: clamp(Math.round(meta.height * scale), 1, 8192), kernel: sharp.kernel.lanczos3, fit: "fill" })
        .normalise()
        .sharpen({ sigma: 1.15, m1: 0.8, m2: 2, x1: 2, y2: 10, y3: 20 })
        .png()
        .toFile(output);
      return ok(buildImageOutput(output, { width: info.width, height: info.height, format: "png", original_size: input.length, strategy: "traditional", detail_text: `${scale}x | ${info.width}x${info.height}` }, originalName), output, start);
    } catch (error) {
      if (mode === "traditional") return fail("upscale_failed", (error as Error).message, start);
    }
  }

  return withAiFallback(fileUrl, clean(params.prompt) || UPSCALE_PROMPT, start, { resolution: scale >= 3 ? "4K" : "2K" });
};

export const imageUpscale: ToolRegistryEntry = { manifest: imageUpscaleManifest, handler: imageUpscaleHandler, timeout: LONG_TIMEOUT_MS * 2 };
const imageRemoveWatermarkManifest: ToolManifest = {
  id: "image.remove_watermark",
  name: "Image Remove Watermark",
  description: "Remove a corner watermark with traditional cleanup first, then AI fallback.",
  category: "image",
  tags: ["image", "watermark", "cleanup", "remove watermark", "retouch"],
  params: [
    { name: "file_url", type: "file", required: true, description: "Image URL", accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"] },
    { name: "placement", type: "enum", required: false, default: "auto", description: "Watermark corner", enum_values: ["auto", "top-left", "top-right", "bottom-left", "bottom-right"] },
    { name: "mode", type: "enum", required: false, default: "auto", description: "Traditional first, AI only, or automatic fallback", enum_values: ["auto", "traditional", "ai"] },
    { name: "prompt", type: "string", required: false, description: "Optional custom fallback prompt for AI mode" },
  ],
  output_type: "file",
  keywords: ["remove watermark", "watermark removal", "retouch image", "去水印", "图片去水印"],
  patterns: ["remove.*watermark", "watermark.*remove", "去水印", "图片.*去水印"],
};

const imageRemoveWatermarkHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  if (!fileUrl) return fail("bad_request", "file_url required", start);
  const placement = normalizePlacement(params.placement);
  const mode = normalizeMode(params.mode);
  const originalName = filenameFromUrl(fileUrl, "image");

  if (mode !== "ai") {
    try {
      const input = await downloadFile(fileUrl);
      const candidate = await detectWatermarkMask(input, placement);
      if (!candidate || candidate.confidence < 0.46) throw new Error("No reliable watermark region detected");
      const repaired = await inpaintMask(input, candidate);
      const output = tempFile("png");
      const info = await sharp(repaired, { failOn: "none" }).png().toFile(output);
      return ok(buildImageOutput(output, { width: info.width, height: info.height, format: "png", original_size: input.length, strategy: "traditional", placement: candidate.placement, confidence: Number(candidate.confidence.toFixed(3)), detail_text: `${candidate.placement} | ${Math.round(candidate.confidence * 100)}%` }, originalName), output, start);
    } catch (error) {
      if (mode === "traditional") return fail("watermark_remove_failed", (error as Error).message, start);
    }
  }

  return withAiFallback(fileUrl, clean(params.prompt) || WATERMARK_PROMPT, start, {});
};

export const imageRemoveWatermark: ToolRegistryEntry = { manifest: imageRemoveWatermarkManifest, handler: imageRemoveWatermarkHandler, timeout: LONG_TIMEOUT_MS * 2 };

const imageRemoveWatermarkBatchManifest: ToolManifest = {
  id: "image.remove_watermark_batch",
  name: "Batch Remove Watermark",
  description: "Remove watermark from multiple images and package the cleaned results.",
  category: "image",
  tags: ["image", "watermark", "batch", "bulk", "zip"],
  params: [
    { name: "file_urls", type: "file", required: true, description: "Multiple image URLs", accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"] },
    { name: "placement", type: "enum", required: false, default: "auto", description: "Watermark corner", enum_values: ["auto", "top-left", "top-right", "bottom-left", "bottom-right"] },
    { name: "mode", type: "enum", required: false, default: "auto", description: "Traditional first, AI only, or automatic fallback", enum_values: ["auto", "traditional", "ai"] },
  ],
  output_type: "file",
  keywords: ["batch watermark removal", "bulk remove watermark", "批量去水印", "批量图片去水印"],
  patterns: ["batch.*watermark", "bulk.*watermark", "批量.*去水印"],
};

const imageRemoveWatermarkBatchHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const urls = parseFileUrls(params, "file_urls");
  if (urls.length === 0) return fail("bad_request", "file_urls required", start);
  const placement = normalizePlacement(params.placement);
  const mode = normalizeMode(params.mode);
  const processed: Array<{ path: string; name: string; url: string; strategy: string }> = [];
  const failures: Array<Record<string, unknown>> = [];

  for (const [index, url] of urls.entries()) {
    const single = await imageRemoveWatermarkHandler({ file_url: url, placement, mode, prompt: params.prompt });
    if (single.status === "success" && single.output_url) {
      const output = (single.output ?? {}) as Record<string, unknown>;
      const filename = typeof output.filename === "string" && output.filename.trim() ? output.filename : `watermark-free-${index + 1}.png`;
      processed.push({ path: single.output_url, name: filename, url, strategy: typeof output.strategy === "string" && output.strategy.trim() ? output.strategy : "traditional" });
      continue;
    }
    failures.push({ source_url: url, error: single.status === "failed" ? single.error?.message ?? "unknown error" : "unknown error" });
  }

  if (processed.length === 0) {
    return fail("batch_failed", failures.map((item) => String(item.error)).join("; ") || "No image processed", start);
  }

  try {
    const zipPath = await createZipArchive(processed.map((item) => ({ path: item.path, name: item.name })));
    return ok({ filename: `watermark-free-batch-${randomUUID().slice(0, 8)}.zip`, format: "zip", count: urls.length, processed_count: processed.length, failed_count: failures.length, items: [...processed.map((item) => ({ source_url: item.url, filename: item.name, strategy: item.strategy })), ...failures], output_files: processed.map((item) => item.name), detail_text: `${processed.length}/${urls.length} images cleaned` }, zipPath, start);
  } catch (error) {
    return fail("zip_failed", (error as Error).message, start);
  }
};

export const imageRemoveWatermarkBatch: ToolRegistryEntry = { manifest: imageRemoveWatermarkBatchManifest, handler: imageRemoveWatermarkBatchHandler, timeout: LONG_TIMEOUT_MS * 3 };
