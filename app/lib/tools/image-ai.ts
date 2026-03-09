import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import type { ToolHandler, ToolManifest, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { fetchIOPaintCurrentModel, fetchIOPaintServerConfig } from "./iopaint-service";
import { runCommand } from "./helpers";
import { register } from "@/lib/server/local-file-store";
import {
  detectWatermarkMask,
  inferWatermarkPlacement,
  imageRemoveWatermark as classicImageRemoveWatermark,
  normalizePlacement,
  type DetectionCandidate,
} from "./image";
import {
  runBackgroundRemovalWorkflow,
  runFaceRestoreWorkflow,
  runIOPaintInpaintWorkflow,
  runImageFallback,
  runMaskedEditFallback,
  runMaskedTextInsertWorkflow,
  prepareImageInput,
  runOutpaintWorkflow,
  runPromptShapeReplaceWorkflow,
  runPromptedOutpaintFallback,
  runReferenceReplaceWorkflow,
  runUpscaleWorkflow,
  runWatermarkRemovalWorkflow,
} from "@/lib/server/iopaint-workflows";

type ProcessingMode = "auto" | "traditional" | "ai";
type StudioPreset =
  | "manual"
  | "watermark"
  | "remove-object"
  | "replace-object"
  | "add-text"
  | "remove-background"
  | "face-restore"
  | "upscale"
  | "outpaint";

const STUDIO_PRESETS: StudioPreset[] = [
  "manual",
  "watermark",
  "remove-object",
  "replace-object",
  "add-text",
  "remove-background",
  "face-restore",
  "upscale",
  "outpaint",
];

const WATERMARK_PROMPT =
  "Remove the watermark cleanly. Preserve the original subject, framing, colors, and texture. Do not add text or extra objects.";

const UPSCALE_PROMPT =
  "Upscale this image carefully. Preserve the original composition, subject, and color palette while restoring crisp detail.";

const REMOVE_OBJECT_PROMPT =
  "Remove the masked object and reconstruct the original background naturally. Preserve perspective, lighting, and texture.";

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      return asArray(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const parseNumber = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeMode = (value: unknown): ProcessingMode => {
  const input = clean(value).toLowerCase();
  if (input === "traditional") return "traditional";
  if (input === "ai") return "ai";
  return "auto";
};

const normalizeStudioPreset = (value: unknown): StudioPreset => {
  const input = clean(value);
  return STUDIO_PRESETS.includes(input as StudioPreset)
    ? (input as StudioPreset)
    : "manual";
};

const filenameFromUrl = (url: string, fallback: string): string => {
  try {
    const parsed = new URL(url);
    return basename(parsed.pathname || "") || fallback;
  } catch {
    return basename(url) || fallback;
  }
};

const safeStem = (value: string, fallback: string): string => {
  const stem = value.replace(/\.[^.]+$/, "").trim();
  const sanitized = stem.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
  return sanitized || fallback;
};

const buildStudioUrl = (
  sourceUrl: string,
  options: {
    preset?: StudioPreset;
    placement?: string;
    autorun?: boolean;
    pluginModel?: string;
    prompt?: string;
    text?: string;
    style?: string;
  } = {},
): string => {
  const params = new URLSearchParams();
  params.set("source", sourceUrl);
  if (options.preset && options.preset !== "manual") {
    params.set("preset", options.preset);
  }
  if (options.placement?.trim()) {
    params.set("placement", options.placement.trim());
  }
  if (options.autorun) {
    params.set("autorun", "1");
  }
  if (options.pluginModel?.trim()) {
    params.set("plugin_model", options.pluginModel.trim());
  }
  if (options.prompt?.trim()) {
    params.set("prompt", options.prompt.trim());
  }
  if (options.text?.trim()) {
    params.set("text", options.text.trim());
  }
  if (options.style?.trim()) {
    params.set("style", options.style.trim());
  }
  return `/dashboard/tools/image.iopaint_studio?${params.toString()}`;
};

const withStudioMetadata = (
  result: Awaited<ReturnType<ToolHandler>>,
  options: {
    studioSourceUrl?: string;
    preset?: StudioPreset;
    placement?: string;
    autorun?: boolean;
    pluginModel?: string;
    prompt?: string;
    text?: string;
    style?: string;
  } = {},
): Awaited<ReturnType<ToolHandler>> => {
  if (result.status !== "success" || !result.output_url || !result.output) {
    return result;
  }
  const previewUrl =
    typeof result.output.preview_url === "string" && result.output.preview_url.trim()
      ? result.output.preview_url
      : result.output_url;
  const studioSourceUrl =
    options.studioSourceUrl?.trim() || previewUrl || result.output_url;
  return {
    ...result,
    output: {
      ...result.output,
      preview_url: previewUrl,
      studio_url:
        typeof result.output.studio_url === "string" && result.output.studio_url.trim()
          ? result.output.studio_url
          : buildStudioUrl(studioSourceUrl, {
            preset: options.preset,
            placement: options.placement,
            autorun: options.autorun,
            pluginModel: options.pluginModel,
            prompt: options.prompt,
            text: options.text,
            style: options.style,
          }),
    },
  };
};

const ok = (
  output: Record<string, unknown>,
  outputUrl: string,
  start: number,
): ReturnType<ToolHandler> =>
  Promise.resolve({
    status: "success",
    output,
    output_url: outputUrl,
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

const buildOutput = (
  artifact: {
    path: string;
    publicUrl?: string;
    output: Record<string, unknown>;
  },
  originalName: string,
  options: {
    studioSourceUrl?: string;
    preset?: StudioPreset;
    placement?: string;
    autorun?: boolean;
    pluginModel?: string;
    prompt?: string;
    text?: string;
    style?: string;
  } = {},
): Record<string, unknown> => {
  const previewUrl =
    typeof artifact.output.preview_url === "string"
      ? artifact.output.preview_url
      : artifact.publicUrl;
  const studioSourceUrl =
    options.studioSourceUrl?.trim() ||
    (typeof previewUrl === "string" ? previewUrl : "");
  return {
    name: originalName,
    ...artifact.output,
    preview_url: previewUrl,
    studio_url:
      studioSourceUrl
        ? buildStudioUrl(studioSourceUrl, {
            preset: options.preset,
            placement: options.placement,
            autorun: options.autorun,
            pluginModel: options.pluginModel,
            prompt: options.prompt,
            text: options.text,
            style: options.style,
          })
      : undefined,
  };
};

type AlphaQualityReport = {
  transparentRatio: number;
  semiTransparentRatio: number;
  opaqueRatio: number;
  alphaRange: number;
  score: number;
  usable: boolean;
};

type WatermarkCleanupQuality = {
  coverage: number;
  insideMeanDiff: number;
  outsideMeanDiff: number;
  score: number;
  acceptable: boolean;
};

const uniqueStrings = (values: Array<string | undefined | null>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const analyzeAlphaQuality = async (imagePath: string): Promise<AlphaQualityReport> => {
  const { data, info } = await sharp(imagePath, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!data.length || !info.width || !info.height || info.channels < 4) {
    return {
      transparentRatio: 0,
      semiTransparentRatio: 0,
      opaqueRatio: 1,
      alphaRange: 0,
      score: 0,
      usable: false,
    };
  }

  let transparent = 0;
  let semi = 0;
  let opaque = 0;
  let minAlpha = 255;
  let maxAlpha = 0;

  for (let index = 3; index < data.length; index += info.channels) {
    const alpha = data[index];
    if (alpha <= 6) {
      transparent += 1;
    } else if (alpha >= 249) {
      opaque += 1;
    } else {
      semi += 1;
    }
    if (alpha < minAlpha) minAlpha = alpha;
    if (alpha > maxAlpha) maxAlpha = alpha;
  }

  const pixels = Math.max(1, transparent + semi + opaque);
  const transparentRatio = transparent / pixels;
  const semiTransparentRatio = semi / pixels;
  const opaqueRatio = opaque / pixels;
  const alphaRange = maxAlpha - minAlpha;
  const score =
    transparentRatio * 0.65 + semiTransparentRatio * 0.25 + (alphaRange / 255) * 0.10;
  const usable =
    alphaRange >= 20 &&
    transparentRatio >= 0.01 &&
    transparentRatio <= 0.98 &&
    opaqueRatio >= 0.01;

  return {
    transparentRatio,
    semiTransparentRatio,
    opaqueRatio,
    alphaRange,
    score,
    usable,
  };
};

const removeBackgroundPrompt = (prompt: string): string =>
  prompt.trim() ||
  "Remove the background cleanly. Isolate the main subject with crisp edges, preserved fine detail, and a transparent or neutral cutout-style result.";

const watermarkMaskToPngPath = async (
  detection: DetectionCandidate,
  width: number,
  height: number,
): Promise<string> => {
  const bytes = Uint8Array.from(detection.mask, (value) => (value ? 255 : 0));
  const outputPath = join(tmpdir(), `omni-watermark-mask-${randomUUID()}.png`);
  await sharp(Buffer.from(bytes), {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .png()
    .toFile(outputPath);
  return outputPath;
};

const estimateWatermarkCandidateQuality = async (
  sourceInput: string,
  candidateInput: string,
  placementInput?: unknown,
): Promise<WatermarkCleanupQuality | null> => {
  const source = await prepareImageInput(sourceInput);
  const candidate = await prepareImageInput(candidateInput);
  const placement = normalizePlacement(placementInput);
  try {
    const sourceMeta = await sharp(source.path, { failOn: "none" }).metadata();
    const width = sourceMeta.width ?? 0;
    const height = sourceMeta.height ?? 0;
    if (!width || !height) return null;

    const detection = await detectWatermarkMask(source.buffer, placement);
    if (!detection || detection.coverage <= 0.0002) {
      return null;
    }

    const [maskRaw, sourceRaw, candidateRaw] = await Promise.all([
      sharp(
        Buffer.from(Uint8Array.from(detection.mask, (value) => (value ? 255 : 0))),
        {
          raw: {
            width,
            height,
            channels: 1,
          },
        },
      )
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(source.path, { failOn: "none" })
        .resize(width, height, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      sharp(candidate.path, { failOn: "none" })
        .resize(width, height, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);

    let insideSamples = 0;
    let insideTotal = 0;
    let outsideSamples = 0;
    let outsideTotal = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const maskOffset = (y * width + x) * maskRaw.info.channels;
        const maskValue = maskRaw.data[maskOffset];
        const sourceOffset = (y * width + x) * sourceRaw.info.channels;
        const candidateOffset = (y * width + x) * candidateRaw.info.channels;
        for (let channel = 0; channel < 3; channel += 1) {
          const diff = Math.abs(
            sourceRaw.data[sourceOffset + channel] - candidateRaw.data[candidateOffset + channel],
          );
          if (maskValue >= 24) {
            insideTotal += diff;
            insideSamples += 1;
          } else {
            outsideTotal += diff;
            outsideSamples += 1;
          }
        }
      }
    }

    const insideMeanDiff = insideSamples > 0 ? insideTotal / insideSamples : 0;
    const outsideMeanDiff = outsideSamples > 0 ? outsideTotal / outsideSamples : 0;
    const score = insideMeanDiff - outsideMeanDiff * 3.2;
    const acceptable =
      insideMeanDiff >= 4.2 &&
      outsideMeanDiff <= Math.max(6.0, insideMeanDiff * 0.34) &&
      score >= 2.2;

    return {
      coverage: detection.coverage,
      insideMeanDiff,
      outsideMeanDiff,
      score,
      acceptable,
    };
  } finally {
    if (fs.existsSync(source.path)) {
      fs.rmSync(source.path, { force: true });
    }
    if (fs.existsSync(candidate.path)) {
      fs.rmSync(candidate.path, { force: true });
    }
  }
};

const buildWatermarkFallbackMask = async (
  sourceInput: string,
  placementInput?: unknown,
): Promise<{ path: string; placement: DetectionCandidate["placement"] } | null> => {
  const source = await prepareImageInput(sourceInput);
  try {
    const metadata = await sharp(source.path, { failOn: "none" }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) return null;
    const requestedPlacement = normalizePlacement(placementInput);
    const placement =
      requestedPlacement === "auto"
        ? await inferWatermarkPlacement(source.buffer)
        : requestedPlacement;
    const detection = await detectWatermarkMask(source.buffer, placement);
    if (!detection || detection.coverage <= 0.0002) return null;
    return {
      path: await watermarkMaskToPngPath(detection, width, height),
      placement: detection.placement,
    };
  } finally {
    if (fs.existsSync(source.path)) {
      fs.rmSync(source.path, { force: true });
    }
  }
};

const buildStudioLaunchOutput = async (
  sourceUrl: string,
  options: {
    preset: StudioPreset;
    placement?: string;
    autorun?: boolean;
    prompt?: string;
    text?: string;
    style?: string;
  },
  start: number,
): Promise<ReturnType<ToolHandler>> => {
  const [serverConfig, currentModel] = await Promise.all([
    fetchIOPaintServerConfig(),
    fetchIOPaintCurrentModel(),
  ]);
  const studioUrl = buildStudioUrl(sourceUrl, options);
  return {
    status: "success",
    output: {
      studio_url: studioUrl,
      preview_url: sourceUrl,
      current_model: currentModel,
      server_config: serverConfig,
      preset: options.preset,
      detail_text: "Studio preset ready.",
    },
    output_url: sourceUrl,
    duration_ms: Date.now() - start,
  };
};

const createZipArchive = async (
  files: Array<{ path: string; name: string }>,
): Promise<string> => {
  if (process.platform !== "win32") {
    throw new Error("Batch ZIP archive is only configured for Windows in this workspace");
  }
  const stageDir = join(tmpdir(), `omni-iopaint-batch-${randomUUID()}`);
  const zipPath = join(tmpdir(), `omni-iopaint-${randomUUID()}.zip`);
  mkdirSync(stageDir, { recursive: true });
  try {
    for (const item of files) {
      const safeName =
        item.name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim() ||
        `result-${randomUUID().slice(0, 6)}${extname(item.path)}`;
      copyFileSync(item.path, join(stageDir, safeName));
    }
    const command = `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`;
    const result = await runCommand(
      "powershell",
      ["-NoProfile", "-Command", command],
      LONG_TIMEOUT_MS,
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Compress-Archive failed");
    }
    return zipPath;
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
};

const withAiFallback = async (
  sourceUrl: string,
  prompt: string,
  start: number,
  extra: Record<string, unknown> = {},
): Promise<ReturnType<ToolHandler>> => {
  try {
    const fallback = await runImageFallback({
      sourceUrl,
      prompt,
      extra,
    });
    return ok(
      {
        ...fallback.output,
        detail_text:
          typeof fallback.output.detail_text === "string" &&
          fallback.output.detail_text.trim()
            ? fallback.output.detail_text
            : "AI fallback",
      },
      fallback.path,
      start,
    );
  } catch (error) {
    return fail("ai_fallback_failed", (error as Error).message, start);
  }
};

const imageUpscaleManifest: ToolManifest = {
  id: "image.upscale",
  name: "Image Upscale",
  description: "Enhance and upscale an image with RealESRGAN, with AI fallback if needed.",
  category: "image",
  tags: ["image", "upscale", "enhance", "realesrgan", "hd", "4k"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Image URL",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "scale",
      type: "number",
      required: false,
      default: 2,
      description: "Scale multiplier",
      min: 1,
      max: 4,
    },
    {
      name: "mode",
      type: "enum",
      required: false,
      default: "auto",
      description: "Fallback policy",
      enum_values: ["auto", "traditional", "ai"],
    },
    {
      name: "plugin_model",
      type: "enum",
      required: false,
      default: "realesr-general-x4v3",
      description: "RealESRGAN model",
      enum_values: [
        "realesr-general-x4v3",
        "RealESRGAN_x4plus",
        "RealESRGAN_x4plus_anime_6B",
      ],
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional AI fallback prompt",
    },
  ],
  output_type: "file",
  keywords: ["upscale image", "enhance image", "hd image", "super resolution"],
  patterns: ["upscale.*image", "enhance.*image", "super.*resolution"],
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
      const result = await runUpscaleWorkflow({
        source: fileUrl,
        scale,
        pluginModel: clean(params.plugin_model) || undefined,
      });
      return ok(
        buildOutput(result, originalName, {
          preset: "upscale",
        }),
        result.path,
        start,
      );
    } catch (error) {
      if (mode === "traditional") {
        return fail("upscale_failed", (error as Error).message, start);
      }
    }
  }

  return withAiFallback(
    fileUrl,
    clean(params.prompt) || UPSCALE_PROMPT,
    start,
    { resolution: scale >= 3 ? "4K" : "2K" },
  );
};

export const imageUpscale: ToolRegistryEntry = {
  manifest: imageUpscaleManifest,
  handler: imageUpscaleHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

const imageRemoveWatermarkManifest: ToolManifest = {
  id: "image.remove_watermark",
  name: "Image Remove Watermark",
  description: "Detect a watermark with rem-wm and clean it with IOPaint.",
  category: "image",
  tags: ["image", "watermark", "remwm", "iopaint", "cleanup", "去水印", "去除水印", "清除水印", "水印清理"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Image URL",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "placement",
      type: "enum",
      required: false,
      default: "auto",
      description: "Hint for watermark placement",
      enum_values: ["auto", "top-left", "top-right", "bottom-left", "bottom-right"],
    },
    {
      name: "mode",
      type: "enum",
      required: false,
      default: "auto",
      description: "Fallback policy",
      enum_values: ["auto", "traditional", "ai"],
    },
    {
      name: "expand_kernel",
      type: "number",
      required: false,
      default: 9,
      description: "Mask expansion kernel size",
      min: 3,
      max: 31,
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional AI fallback prompt",
    },
  ],
  output_type: "file",
  keywords: [
    "remove watermark",
    "watermark removal",
    "watermark cleanup",
    "去水印",
    "去除水印",
    "清除水印",
    "水印清理",
    "图片去水印",
  ],
  patterns: [
    "remove.*watermark",
    "watermark.*remove",
    "watermark.*cleanup",
    "去.*水印",
    "清除.*水印",
    "清理.*水印",
    "图片.*去水印",
  ],
};

const imageRemoveWatermarkHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  if (!fileUrl) return fail("bad_request", "file_url required", start);
  const mode = normalizeMode(params.mode);
  const originalName = filenameFromUrl(fileUrl, "image");
  const placement = normalizePlacement(params.placement);
  const studioOptions = {
    studioSourceUrl: fileUrl,
    preset: "watermark" as const,
    placement: placement || "auto",
    autorun: true,
  };
  let localizedMask: { path: string; placement: DetectionCandidate["placement"] } | null = null;

  try {
    localizedMask = await buildWatermarkFallbackMask(fileUrl, placement);

    if (mode !== "ai") {
      if (placement == "auto") {
        try {
          const autoWorkflow = await runWatermarkRemovalWorkflow({
            source: fileUrl,
            placement: localizedMask?.placement || placement,
            expandKernel: clamp(Math.round(parseNumber(params.expand_kernel, 9)), 3, 31),
          });
          return ok(
            buildOutput(autoWorkflow, originalName, studioOptions),
            autoWorkflow.path,
            start,
          );
        } catch {}
      }

      let bestTraditional:
        | {
            source: "classic" | "localized_iopaint" | "workflow";
            quality: WatermarkCleanupQuality;
            result:
              | Awaited<ReturnType<ToolHandler>>
              | Awaited<ReturnType<typeof runIOPaintInpaintWorkflow>>
              | Awaited<ReturnType<typeof runWatermarkRemovalWorkflow>>;
          }
        | null = null;
      const classic = await classicImageRemoveWatermark.handler({
        file_url: fileUrl,
        placement,
        mode: "traditional",
        prompt: params.prompt,
      });
      if (classic.status === "success" && classic.output_url) {
        try {
          const quality = await estimateWatermarkCandidateQuality(
            fileUrl,
            classic.output_url,
            placement,
          );
          if (quality) {
            bestTraditional = {
              source: "classic",
              quality,
              result: classic,
            };
          }
        } catch {
          bestTraditional = null;
        }
      }

      if (localizedMask) {
        try {
          const localized = await runIOPaintInpaintWorkflow({
            source: fileUrl,
            mask: localizedMask.path,
            filenameStem: `${safeStem(originalName, "watermark-free")}-localized`,
            detailText: "Corner mask + IOPaint",
            strategy: "corner_mask_iopaint",
            payload: {
              prompt:
                "Remove only the watermark within the mask and reconstruct the original background naturally. Preserve all remaining pixels exactly.",
              negative_prompt:
                "do not alter the subject, do not add text, do not add logos, do not change the composition",
              hd_strategy: "Crop",
              hd_strategy_crop_trigger_size: 1024,
              hd_strategy_crop_margin: 128,
              sd_mask_blur: 8,
              sd_keep_unmasked_area: true,
              cv2_radius: 5,
            },
            outputExtra: {
              placement,
            },
          });
          const quality = await estimateWatermarkCandidateQuality(
            fileUrl,
            localized.path,
            placement,
          );
          if (quality && (!bestTraditional || quality.score > bestTraditional.quality.score)) {
            bestTraditional = {
              source: "localized_iopaint",
              quality,
              result: localized,
            };
          }
        } catch (error) {
          if (mode === "traditional" && !bestTraditional) {
            return fail("watermark_remove_failed", (error as Error).message, start);
          }
        }
      }

      try {
        const result = await runWatermarkRemovalWorkflow({
          source: fileUrl,
          placement,
          expandKernel: clamp(Math.round(parseNumber(params.expand_kernel, 9)), 3, 31),
        });
        const quality = await estimateWatermarkCandidateQuality(fileUrl, result.path, placement);
        if (quality && (!bestTraditional || quality.score > bestTraditional.quality.score)) {
          bestTraditional = {
            source: "workflow",
            quality,
            result,
          };
        }
      } catch (error) {
        if (mode === "traditional" && !bestTraditional) {
          return fail("watermark_remove_failed", (error as Error).message, start);
        }
      }

      if (bestTraditional?.source === "workflow") {
        const workflowResult = bestTraditional.result as Awaited<
          ReturnType<typeof runWatermarkRemovalWorkflow>
        >;
        return ok(
          buildOutput(workflowResult, originalName, studioOptions),
          workflowResult.path,
          start,
        );
      }
      if (bestTraditional?.source === "localized_iopaint") {
        const localizedResult = bestTraditional.result as Awaited<
          ReturnType<typeof runIOPaintInpaintWorkflow>
        >;
        return ok(
          buildOutput(localizedResult, originalName, studioOptions),
          localizedResult.path,
          start,
        );
      }
      if (bestTraditional?.source === "classic") {
        return withStudioMetadata(
          bestTraditional.result as Awaited<ReturnType<ToolHandler>>,
          studioOptions,
        );
      }
      }

    if (localizedMask) {
      const masked = await runMaskedEditFallback({
        source: fileUrl,
        mask: localizedMask.path,
        mode: "remove-object",
        prompt: clean(params.prompt) || WATERMARK_PROMPT,
        filenameStem: `${safeStem(originalName, "watermark-free")}-masked-ai`,
      });
      return ok(
        buildOutput(masked, originalName, {
          ...studioOptions,
          prompt: clean(params.prompt) || WATERMARK_PROMPT,
        }),
        masked.path,
        start,
      );
    }
  } finally {
    if (localizedMask?.path && fs.existsSync(localizedMask.path)) {
      fs.rmSync(localizedMask.path, { force: true });
    }
  }

  return withAiFallback(fileUrl, clean(params.prompt) || WATERMARK_PROMPT, start);
};

export const imageRemoveWatermark: ToolRegistryEntry = {
  manifest: imageRemoveWatermarkManifest,
  handler: imageRemoveWatermarkHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

const imageRemoveWatermarkBatchManifest: ToolManifest = {
  id: "image.remove_watermark_batch",
  name: "Batch Remove Watermark",
  description: "Batch detect and remove watermarks, then package the results.",
  category: "image",
  tags: ["image", "watermark", "batch", "bulk", "zip", "批量去水印"],
  params: [
    {
      name: "file_urls",
      type: "file",
      required: true,
      description: "Image URLs",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "expand_kernel",
      type: "number",
      required: false,
      default: 9,
      description: "Mask expansion kernel size",
      min: 3,
      max: 31,
    },
  ],
  output_type: "file",
  keywords: ["batch remove watermark", "bulk watermark cleanup", "批量去水印", "批量图片去水印"],
  patterns: ["batch.*watermark", "bulk.*watermark", "批量.*去水印"],
};

const imageRemoveWatermarkBatchHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrls = asArray(params.file_urls);
  if (fileUrls.length === 0) {
    return fail("bad_request", "file_urls required", start);
  }
  const mode = normalizeMode(params.mode);
  const processed: Array<{ path: string; name: string; output: Record<string, unknown> }> = [];
  const failures: Array<Record<string, unknown>> = [];

  for (const [index, url] of fileUrls.entries()) {
    const single = await imageRemoveWatermarkHandler({
      file_url: url,
      placement: params.placement,
      mode,
      expand_kernel: params.expand_kernel,
      prompt: params.prompt,
    });
    if (single.status === "success" && single.output_url) {
      const output = (single.output ?? {}) as Record<string, unknown>;
      processed.push({
        path: single.output_url,
        name:
          typeof output.filename === "string" && output.filename.trim()
            ? output.filename
            : `watermark-free-${index + 1}.png`,
        output,
      });
      continue;
    }
    failures.push({
      source_url: url,
      error:
        single.status === "failed"
          ? single.error?.message ?? "unknown error"
          : "unknown error",
    });
  }

  if (processed.length === 0) {
    return fail(
      "batch_watermark_failed",
      failures.map((item) => String(item.error)).join("; ") || "No image processed",
      start,
    );
  }

  const zipPath = await createZipArchive(
    processed.map((item) => ({
      path: item.path,
      name: item.name,
    })),
  );
  const compressedSize = statSync(zipPath).size;
  const zipFilename = `watermark-free-batch-${randomUUID().slice(0, 8)}.zip`;
  const outputFileUrl = register(zipPath, zipFilename);
  return ok(
    {
      filename: zipFilename,
      format: "zip",
      count: fileUrls.length,
      processed_count: processed.length,
      failed_count: failures.length,
      size_bytes: compressedSize,
      detail_text: `${processed.length}/${fileUrls.length} images cleaned`,
      output_file_url: outputFileUrl,
      items: [
        ...processed.map((item) => item.output),
        ...failures,
      ],
    },
    zipPath,
    start,
  );
};

export const imageRemoveWatermarkBatch: ToolRegistryEntry = {
  manifest: imageRemoveWatermarkBatchManifest,
  handler: imageRemoveWatermarkBatchHandler,
  timeout: LONG_TIMEOUT_MS * 4,
};

const imageRemoveBackgroundManifest: ToolManifest = {
  id: "image.remove_background",
  name: "Image Remove Background",
  description: "Cut out the subject with IOPaint RemoveBG, with model fallback and AI backup if needed.",
  category: "image",
  tags: ["image", "remove background", "cutout", "matting", "removebg", "抠图", "去背景", "去背", "扣背景", "扣除背景"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Image URL",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "plugin_model",
      type: "string",
      required: false,
      description: "RemoveBG model name",
      default: "briaai/RMBG-1.4",
    },
    {
      name: "mode",
      type: "enum",
      required: false,
      default: "auto",
      description: "Fallback policy",
      enum_values: ["auto", "traditional", "ai"],
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional fallback prompt",
    },
  ],
  output_type: "file",
  keywords: [
    "remove background",
    "cut out subject",
    "background cutout",
    "抠图",
    "去背景",
    "去背",
    "抠出主体",
    "扣背景",
    "扣除背景",
  ],
  patterns: [
    "remove.*background",
    "cut.*out",
    "background.*cutout",
    "抠图",
    "去.*背景",
    "去背",
    "抠.*主体",
    "扣.*背景",
  ],
};

const imageRemoveBackgroundHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  if (!fileUrl) return fail("bad_request", "file_url required", start);
  const mode = normalizeMode(params.mode);
  const originalName = filenameFromUrl(fileUrl, "image");

  if (mode !== "ai") {
    let lastError: Error | null = null;
    let best:
      | {
          result: Awaited<ReturnType<typeof runBackgroundRemovalWorkflow>>;
          quality: AlphaQualityReport;
          pluginModel?: string;
        }
      | null = null;

    try {
      const serverConfig = await fetchIOPaintServerConfig();
      const modelCandidates = uniqueStrings([
        clean(params.plugin_model) || undefined,
        serverConfig.removeBGModel,
        ...(serverConfig.removeBGModels ?? []),
      ]);

      for (const pluginModel of modelCandidates.length ? modelCandidates : [clean(params.plugin_model) || "briaai/RMBG-1.4"]) {
        try {
          const result = await runBackgroundRemovalWorkflow({
            source: fileUrl,
            pluginModel: pluginModel || undefined,
          });
          const quality = await analyzeAlphaQuality(result.path);
          if (!best || quality.score > best.quality.score) {
            best = { result, quality, pluginModel: pluginModel || undefined };
          }
          if (quality.usable) {
            return ok(
              buildOutput(result, originalName, {
                studioSourceUrl: fileUrl,
                preset: "remove-background",
                autorun: true,
                pluginModel: pluginModel || undefined,
              }),
              result.path,
              start,
            );
          }
        } catch (error) {
          lastError = error as Error;
        }
      }
    } catch (error) {
      lastError = error as Error;
    }

    if (best) {
      if (mode === "traditional") {
        return ok(
          buildOutput(best.result, originalName, {
            studioSourceUrl: fileUrl,
            preset: "remove-background",
            autorun: true,
            pluginModel: best.pluginModel,
          }),
          best.result.path,
          start,
        );
      }
      if (best.quality.alphaRange >= 12 && best.quality.transparentRatio >= 0.005) {
        return ok(
          buildOutput(best.result, originalName, {
            studioSourceUrl: fileUrl,
            preset: "remove-background",
            autorun: true,
            pluginModel: best.pluginModel,
          }),
          best.result.path,
          start,
        );
      }
    } else if (mode === "traditional" && lastError) {
      return fail("remove_background_failed", lastError.message, start);
    }
  }

  try {
    return withAiFallback(fileUrl, removeBackgroundPrompt(clean(params.prompt)), start, {
      transparent_background: true,
      cutout: true,
    });
  } catch (error) {
    return fail("remove_background_failed", (error as Error).message, start);
  }
};

export const imageRemoveBackground: ToolRegistryEntry = {
  manifest: imageRemoveBackgroundManifest,
  handler: imageRemoveBackgroundHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

const imageFaceRestoreManifest: ToolManifest = {
  id: "image.face_restore",
  name: "Image Face Restore",
  description: "Restore portraits with GFPGAN or RestoreFormer.",
  category: "image",
  tags: ["image", "face restore", "portrait", "gfpgan", "restoreformer"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Image URL",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "engine",
      type: "enum",
      required: false,
      default: "GFPGAN",
      description: "Portrait restoration engine",
      enum_values: ["GFPGAN", "RestoreFormer"],
    },
  ],
  output_type: "file",
  keywords: ["face restore", "restore portrait", "portrait cleanup"],
  patterns: ["face.*restore", "portrait.*restore", "portrait.*cleanup"],
};

const imageFaceRestoreHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  if (!fileUrl) return fail("bad_request", "file_url required", start);
  try {
    const result = await runFaceRestoreWorkflow({
      source: fileUrl,
      engine: clean(params.engine) === "RestoreFormer" ? "RestoreFormer" : "GFPGAN",
    });
    return ok(
      buildOutput(result, filenameFromUrl(fileUrl, "portrait"), {
        preset: "face-restore",
      }),
      result.path,
      start,
    );
  } catch (error) {
    return fail("face_restore_failed", (error as Error).message, start);
  }
};

export const imageFaceRestore: ToolRegistryEntry = {
  manifest: imageFaceRestoreManifest,
  handler: imageFaceRestoreHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

const imageOutpaintManifest: ToolManifest = {
  id: "image.outpaint",
  name: "Image Outpaint",
  description: "Expand an image canvas and fill the new area with IOPaint.",
  category: "image",
  tags: ["image", "outpaint", "expand", "canvas", "extend"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Image URL",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "top",
      type: "number",
      required: false,
      default: 0,
      description: "Pixels to expand on top",
      min: 0,
      max: 2048,
    },
    {
      name: "right",
      type: "number",
      required: false,
      default: 128,
      description: "Pixels to expand on right",
      min: 0,
      max: 2048,
    },
    {
      name: "bottom",
      type: "number",
      required: false,
      default: 0,
      description: "Pixels to expand on bottom",
      min: 0,
      max: 2048,
    },
    {
      name: "left",
      type: "number",
      required: false,
      default: 128,
      description: "Pixels to expand on left",
      min: 0,
      max: 2048,
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional outpaint prompt",
    },
  ],
  output_type: "file",
  keywords: ["outpaint image", "extend image", "expand canvas"],
  patterns: ["outpaint.*image", "extend.*image", "expand.*canvas"],
};

const imageOutpaintHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const fileUrl = clean(params.file_url);
  if (!fileUrl) return fail("bad_request", "file_url required", start);
  const top = clamp(Math.round(parseNumber(params.top, 0)), 0, 2048);
  const right = clamp(Math.round(parseNumber(params.right, 128)), 0, 2048);
  const bottom = clamp(Math.round(parseNumber(params.bottom, 0)), 0, 2048);
  const left = clamp(Math.round(parseNumber(params.left, 128)), 0, 2048);
  const prompt = clean(params.prompt);
  try {
    let result;
    if (prompt) {
      try {
        result = await runPromptedOutpaintFallback({
          source: fileUrl,
          top,
          right,
          bottom,
          left,
          prompt,
        });
      } catch {
        result = await runOutpaintWorkflow({
          source: fileUrl,
          top,
          right,
          bottom,
          left,
          payload: {
            prompt,
            negative_prompt: clean(params.negative_prompt),
          },
        });
      }
    } else {
      result = await runOutpaintWorkflow({
        source: fileUrl,
        top,
        right,
        bottom,
        left,
        payload: {
          prompt,
          negative_prompt: clean(params.negative_prompt),
        },
      });
    }
    return ok(
      buildOutput(result, filenameFromUrl(fileUrl, "outpaint"), {
        preset: "outpaint",
      }),
      result.path,
      start,
    );
  } catch (error) {
    return fail("outpaint_failed", (error as Error).message, start);
  }
};

export const imageOutpaint: ToolRegistryEntry = {
  manifest: imageOutpaintManifest,
  handler: imageOutpaintHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

const imageRemoveObjectManifest: ToolManifest = {
  id: "image.remove_object",
  name: "Remove Object",
  description:
    "Open IOPaint Studio in object-removal mode. Mask the region, describe the cleanup if needed, and apply the edit.",
  category: "image",
  tags: ["image", "remove", "object", "erase", "retouch", "iopaint"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Source image to edit",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional cleanup instruction for the masked region",
    },
    {
      name: "mask_url",
      type: "file",
      required: false,
      description: "Optional mask image. If provided, run the edit immediately instead of only opening Studio.",
      accept: [".png", ".jpg", ".jpeg", ".webp"],
    },
  ],
  output_type: "json",
  keywords: ["remove object", "erase object", "remove person", "remove item from photo"],
  patterns: ["remove.*object", "erase.*object", "remove.*person", "remove.*item"],
};

const imageRemoveObjectHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const sourceUrl = clean(params.file_url);
  if (!sourceUrl) {
    return fail("remove_object_missing_source", "Missing source image", start);
  }
  try {
    const maskUrl = clean(params.mask_url);
    if (maskUrl) {
      const result = await runIOPaintInpaintWorkflow({
        source: sourceUrl,
        mask: maskUrl,
        filenameStem: filenameFromUrl(sourceUrl, "object-removed"),
        detailText: "Masked object removed",
        strategy: "iopaint_remove_object",
        payload: {
          prompt: clean(params.prompt) || REMOVE_OBJECT_PROMPT,
          negative_prompt: "",
          hd_strategy: "Crop",
          hd_strategy_crop_trigger_size: 1024,
          hd_strategy_crop_margin: 128,
          sd_mask_blur: 10,
          sd_keep_unmasked_area: true,
          cv2_radius: 4,
        },
        outputExtra: {
          mask_applied: true,
        },
      });
      return ok(
        buildOutput(result, filenameFromUrl(sourceUrl, "object-removed"), {
          preset: "remove-object",
          prompt: clean(params.prompt),
        }),
        result.path,
        start,
      );
    }
    return await buildStudioLaunchOutput(
      sourceUrl,
      {
        preset: "remove-object",
        prompt: clean(params.prompt),
      },
      start,
    );
  } catch (error) {
    return fail("remove_object_failed", (error as Error).message, start);
  }
};

export const imageRemoveObject: ToolRegistryEntry = {
  manifest: imageRemoveObjectManifest,
  handler: imageRemoveObjectHandler,
  timeout: LONG_TIMEOUT_MS,
};

const imageReplaceObjectManifest: ToolManifest = {
  id: "image.replace_object",
  name: "Replace Object",
  description:
    "Open IOPaint Studio in replacement mode. Mask the target, prompt the new object, and optionally use a reference image.",
  category: "image",
  tags: ["image", "replace", "object", "swap", "retouch", "iopaint"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Source image to edit",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Description of the new object to place inside the masked region",
    },
    {
      name: "mask_url",
      type: "file",
      required: false,
      description: "Optional mask image. If provided, run the replacement immediately.",
      accept: [".png", ".jpg", ".jpeg", ".webp"],
    },
    {
      name: "reference_image_url",
      type: "file",
      required: false,
      description: "Optional reference image to guide the replacement result",
      accept: [".png", ".jpg", ".jpeg", ".webp"],
    },
  ],
  output_type: "json",
  keywords: ["replace object", "swap object", "replace item in photo", "change object"],
  patterns: ["replace.*object", "swap.*object", "change.*object"],
};

const imageReplaceObjectHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const sourceUrl = clean(params.file_url);
  if (!sourceUrl) {
    return fail("replace_object_missing_source", "Missing source image", start);
  }
  try {
    const maskUrl = clean(params.mask_url);
    if (maskUrl) {
      const referenceImage = clean(params.reference_image_url);
      const result = referenceImage
        ? await runReferenceReplaceWorkflow({
          source: sourceUrl,
          mask: maskUrl,
          prompt: clean(params.prompt),
          referenceImage,
          filenameStem: filenameFromUrl(sourceUrl, "object-replaced"),
        })
        : await runPromptShapeReplaceWorkflow({
          source: sourceUrl,
          mask: maskUrl,
          prompt: clean(params.prompt),
          filenameStem: filenameFromUrl(sourceUrl, "object-replaced"),
        }).catch(() =>
          runMaskedEditFallback({
            source: sourceUrl,
            mask: maskUrl,
            mode: "replace-object",
            prompt: clean(params.prompt),
            referenceImage,
            filenameStem: filenameFromUrl(sourceUrl, "object-replaced"),
          }),
        );
      return ok(
        buildOutput(result, filenameFromUrl(sourceUrl, "object-replaced"), {
          preset: "replace-object",
          prompt: clean(params.prompt),
        }),
        result.path,
        start,
      );
    }
    return await buildStudioLaunchOutput(
      sourceUrl,
      {
        preset: "replace-object",
        prompt: clean(params.prompt),
      },
      start,
    );
  } catch (error) {
    return fail("replace_object_failed", (error as Error).message, start);
  }
};

export const imageReplaceObject: ToolRegistryEntry = {
  manifest: imageReplaceObjectManifest,
  handler: imageReplaceObjectHandler,
  timeout: LONG_TIMEOUT_MS,
};

const imageAddTextManifest: ToolManifest = {
  id: "image.add_text",
  name: "Add Text To Image",
  description:
    "Open IOPaint Studio in text mode. Mask the placement, type the exact words, and guide the styling with a prompt.",
  category: "image",
  tags: ["image", "text", "typography", "caption", "poster", "iopaint"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: true,
      description: "Source image to edit",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "text",
      type: "string",
      required: false,
      description: "Exact text to render in the masked region",
    },
    {
      name: "style",
      type: "string",
      required: false,
      description: "Optional text style hint, such as bold white sans-serif",
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional extra prompt for the text treatment",
    },
    {
      name: "mask_url",
      type: "file",
      required: false,
      description: "Optional mask image. If provided, run the text insert immediately.",
      accept: [".png", ".jpg", ".jpeg", ".webp"],
    },
  ],
  output_type: "json",
  keywords: ["add text to image", "poster text", "draw text on photo", "caption image"],
  patterns: ["add.*text", "draw.*text", "caption.*image", "poster.*text"],
};

const imageAddTextHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const sourceUrl = clean(params.file_url);
  if (!sourceUrl) {
    return fail("add_text_missing_source", "Missing source image", start);
  }
  try {
    const maskUrl = clean(params.mask_url);
    if (maskUrl) {
      let result;
      try {
        result = await runMaskedTextInsertWorkflow({
          source: sourceUrl,
          mask: maskUrl,
          prompt: clean(params.prompt),
          text: clean(params.text),
          style: clean(params.style),
          filenameStem: filenameFromUrl(sourceUrl, "text-insert"),
        });
      } catch {
        result = await runMaskedEditFallback({
          source: sourceUrl,
          mask: maskUrl,
          mode: "add-text",
          prompt: clean(params.prompt),
          text: clean(params.text),
          style: clean(params.style),
          filenameStem: filenameFromUrl(sourceUrl, "text-insert"),
        });
      }
      return ok(
        buildOutput(result, filenameFromUrl(sourceUrl, "text-insert"), {
          preset: "add-text",
          prompt: clean(params.prompt),
          text: clean(params.text),
          style: clean(params.style),
        }),
        result.path,
        start,
      );
    }
    return await buildStudioLaunchOutput(
      sourceUrl,
      {
        preset: "add-text",
        prompt: clean(params.prompt),
        text: clean(params.text),
        style: clean(params.style),
      },
      start,
    );
  } catch (error) {
    return fail("add_text_failed", (error as Error).message, start);
  }
};

export const imageAddText: ToolRegistryEntry = {
  manifest: imageAddTextManifest,
  handler: imageAddTextHandler,
  timeout: LONG_TIMEOUT_MS,
};

const imageIOPaintStudioManifest: ToolManifest = {
  id: "image.iopaint_studio",
  name: "IOPaint Studio",
  description: "Full IOPaint workspace with masking, segmentation, plugins, and advanced model controls.",
  category: "image",
  tags: ["image", "iopaint", "studio", "mask", "inpaint", "outpaint"],
  params: [
    {
      name: "file_url",
      type: "file",
      required: false,
      description: "Optional source image",
      accept: [".jpg", ".jpeg", ".png", ".webp", ".avif"],
    },
    {
      name: "preset",
      type: "enum",
      required: false,
      default: "manual",
      description: "Preset workspace mode",
      enum_values: [
        "manual",
        "watermark",
        "remove-object",
        "replace-object",
        "add-text",
        "remove-background",
        "face-restore",
        "upscale",
        "outpaint",
      ],
    },
    {
      name: "placement",
      type: "enum",
      required: false,
      default: "auto",
      description: "Watermark placement hint",
      enum_values: ["auto", "top-left", "top-right", "bottom-left", "bottom-right"],
    },
    {
      name: "autorun",
      type: "boolean",
      required: false,
      default: false,
      description: "Auto-run preset setup when the studio loads",
    },
    {
      name: "prompt",
      type: "string",
      required: false,
      description: "Optional prompt to prefill the Studio composer",
    },
    {
      name: "text",
      type: "string",
      required: false,
      description: "Optional exact text for the text preset",
    },
    {
      name: "style",
      type: "string",
      required: false,
      description: "Optional text style hint for the text preset",
    },
  ],
  output_type: "json",
  keywords: ["iopaint studio", "image studio", "edit image", "advanced image editor"],
  patterns: ["iopaint.*studio", "image.*studio", "advanced.*image.*editor"],
};

const imageIOPaintStudioHandler: ToolHandler = async (params) => {
  const start = Date.now();
  try {
    const [serverConfig, currentModel] = await Promise.all([
      fetchIOPaintServerConfig(),
      fetchIOPaintCurrentModel(),
    ]);
    const sourceUrl = clean(params.file_url);
    const preset = normalizeStudioPreset(params.preset);
    const placement = clean(params.placement);
    const autorun = Boolean(params.autorun);
    const prompt = clean(params.prompt);
    const text = clean(params.text);
    const style = clean(params.style);
    const studioUrl = sourceUrl
      ? buildStudioUrl(sourceUrl, { preset, placement, autorun, prompt, text, style })
      : "/dashboard/tools/image.iopaint_studio";
    return {
      status: "success",
      output: {
        studio_url: studioUrl,
        current_model: currentModel,
        server_config: serverConfig,
      },
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return fail("iopaint_studio_failed", (error as Error).message, start);
  }
};

export const imageIOPaintStudio: ToolRegistryEntry = {
  manifest: imageIOPaintStudioManifest,
  handler: imageIOPaintStudioHandler,
  timeout: LONG_TIMEOUT_MS,
};
