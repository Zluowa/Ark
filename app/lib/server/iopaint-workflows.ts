import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { register } from "@/lib/server/local-file-store";
import { generateImage } from "@/lib/tools/image-gen";
import {
  bufferToDataUrl,
  imageUrlToDataUrl,
  runIOPaintAdjustMask,
  runIOPaintInpaint,
  runIOPaintPluginImage,
  runIOPaintPluginMask,
  switchIOPaintModel,
  switchIOPaintPluginModel,
  type IOPaintImageBinary,
  type IOPaintInpaintPayload,
  type IOPaintRunPluginPayload,
} from "@/lib/tools/iopaint-service";
import { detectRemwmMask, detectRemwmMaskBatch } from "@/lib/tools/remwm-service";

const API_ORIGIN = process.env.OMNIAGENT_INTERNAL_ORIGIN?.trim() || "http://127.0.0.1:3010";

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const SUPPORTED_FALLBACK_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "9:21",
] as const;

const normalizeImageExt = (value: string): string => {
  const ext = value.trim().toLowerCase().replace(/^\./, "");
  if (!ext) return "png";
  if (ext === "jpeg") return "jpg";
  return ext;
};

const looksLikeUrl = (value: string): boolean =>
  /^https?:\/\//i.test(value) || value.startsWith("/api/");

const absoluteUrl = (value: string): string => {
  if (value.startsWith("/api/")) {
    return `${API_ORIGIN}${value}`;
  }
  return value;
};

const safeStem = (value: string, fallback: string): string => {
  const stem = value.replace(/\.[^.]+$/, "").trim();
  const sanitized = stem.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
  return sanitized || fallback;
};

const tempImagePath = (ext: string): string =>
  join(tmpdir(), `omni-iopaint-${randomUUID()}.${normalizeImageExt(ext)}`);

const parseDataUrl = (
  value: string,
): { buffer: Buffer; mimeType: string; ext: string } => {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  const mimeType = match[1].trim().toLowerCase();
  const ext = IMAGE_EXT_BY_MIME[mimeType] || "png";
  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType,
    ext,
  };
};

const filenameFromInput = (input: string, fallback: string): string => {
  if (!input.trim()) return fallback;
  if (looksLikeUrl(input)) {
    try {
      const parsed = new URL(absoluteUrl(input));
      return basename(parsed.pathname || "") || fallback;
    } catch {
      return fallback;
    }
  }
  if (input.startsWith("data:")) {
    return fallback;
  }
  return basename(input) || fallback;
};

const fetchInputBuffer = async (
  input: string,
): Promise<{ buffer: Buffer; mimeType: string; ext: string; filename: string }> => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Missing image input");
  }

  if (trimmed.startsWith("data:")) {
    const parsed = parseDataUrl(trimmed);
    return {
      ...parsed,
      filename: `image.${parsed.ext}`,
    };
  }

  if (looksLikeUrl(trimmed)) {
    const url = absoluteUrl(trimmed);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType =
      response.headers.get("content-type")?.trim().toLowerCase() || "image/png";
    const ext =
      IMAGE_EXT_BY_MIME[mimeType] ||
      normalizeImageExt(extname(new URL(url).pathname || "").replace(/^\./, "")) ||
      "png";
    return {
      buffer,
      mimeType,
      ext,
      filename: filenameFromInput(url, `image.${ext}`),
    };
  }

  if (!existsSync(trimmed)) {
    throw new Error(`Input not found: ${trimmed}`);
  }

  const ext = normalizeImageExt(extname(trimmed).replace(/^\./, "")) || "png";
  return {
    buffer: readFileSync(trimmed),
    mimeType: Object.entries(IMAGE_EXT_BY_MIME).find(([, candidate]) => candidate === ext)?.[0] || "image/png",
    ext,
    filename: filenameFromInput(trimmed, `image.${ext}`),
  };
};

export type PreparedImageInput = {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  filename: string;
  path: string;
  dataUrl: string;
};

export const prepareImageInput = async (input: string): Promise<PreparedImageInput> => {
  const loaded = await fetchInputBuffer(input);
  const path = tempImagePath(loaded.ext);
  writeFileSync(path, loaded.buffer);
  return {
    ...loaded,
    path,
    dataUrl: bufferToDataUrl(loaded.buffer, loaded.mimeType),
  };
};

const persistBinaryImage = async (
  binary: IOPaintImageBinary,
  fallbackStem: string,
  options: {
    filename?: string;
    detailText?: string;
    strategy?: string;
    extra?: Record<string, unknown>;
  } = {},
): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const ext = normalizeImageExt(binary.ext || IMAGE_EXT_BY_MIME[binary.contentType] || "png");
  const filename =
    options.filename?.trim() ||
    `${safeStem(fallbackStem, "image")}-${randomUUID().slice(0, 8)}.${ext}`;
  const path = tempImagePath(ext);
  writeFileSync(path, binary.buffer);

  const metadata = await sharp(binary.buffer, { failOn: "none" }).metadata();
  const publicUrl = register(path, filename);

  return {
    path,
    publicUrl,
    output: {
      filename,
      format: ext,
      width: metadata.width,
      height: metadata.height,
      size_bytes: binary.buffer.length,
      seed: binary.seed,
      detail_text: options.detailText,
      strategy: options.strategy,
      ...options.extra,
    },
  };
};

const ratioValue = (value: string): number => {
  const [w, h] = value.split(":").map((part) => Number(part.trim()));
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) {
    return 1;
  }
  return w / h;
};

const nearestSupportedAspectRatio = (width: number, height: number): string => {
  if (!width || !height) return "1:1";
  const target = width / height;
  let best = "1:1";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of SUPPORTED_FALLBACK_ASPECT_RATIOS) {
    const distance = Math.abs(Math.log(target / ratioValue(candidate)));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
};

const normalizeGeneratedImageResult = async (
  result: Awaited<ReturnType<typeof generateImage.handler>>,
  options: {
    filenameStem: string;
    strategy: string;
    detailText: string;
    extra?: Record<string, unknown>;
  },
): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  if (result.status !== "success" || !result.output_url) {
    throw new Error(result.error?.message || "AI image fallback failed");
  }

  const suggestedName =
    typeof result.output?.filename === "string" && result.output.filename.trim()
      ? result.output.filename.trim()
      : `${safeStem(options.filenameStem, "edited")}-${randomUUID().slice(0, 8)}.png`;
  const publicUrl = looksLikeUrl(result.output_url)
    ? absoluteUrl(result.output_url)
    : register(result.output_url, suggestedName);

  return {
    path: result.output_url,
    publicUrl,
    output: {
      ...(result.output ?? {}),
      output_file_url: publicUrl,
      detail_text: options.detailText,
      strategy: options.strategy,
      ...(options.extra ?? {}),
    },
  };
};

type MaskBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  coverage: number;
  maskPngBuffer: Buffer;
};

const escapeSvgText = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const parseColorHint = (value: string): string => {
  const lower = value.toLowerCase();
  if (lower.includes("black")) return "#05070b";
  if (lower.includes("gold")) return "#f6d36b";
  if (lower.includes("yellow")) return "#ffd25f";
  if (lower.includes("blue")) return "#84b8ff";
  if (lower.includes("red")) return "#ff647f";
  if (lower.includes("green")) return "#7ce08f";
  if (lower.includes("pink")) return "#ff73a2";
  return "#ffffff";
};

const textStyleSpec = (style: string, prompt: string) => {
  const hint = `${style} ${prompt}`.toLowerCase();
  const serif = hint.includes("serif");
  const mono = hint.includes("mono");
  const italic = hint.includes("italic");
  const bold = hint.includes("bold") || hint.includes("heavy") || hint.includes("poster");
  const glow = hint.includes("glow") || hint.includes("neon");
  const shadow = glow || hint.includes("shadow");
  return {
    fill: parseColorHint(hint),
    family: mono
      ? "'SFMono-Regular', 'JetBrains Mono', Consolas, monospace"
      : serif
        ? "'Georgia', 'Times New Roman', serif"
        : "'SF Pro Display', 'Helvetica Neue', Arial, sans-serif",
    weight: bold ? 700 : 500,
    italic,
    shadow,
    glow,
  };
};

const resolveShapeFromPrompt = (prompt: string): "circle" | "square" | "triangle" | "hex" => {
  const lower = prompt.toLowerCase();
  if (lower.includes("circle") || lower.includes("orb")) return "circle";
  if (lower.includes("triangle")) return "triangle";
  if (lower.includes("square") || lower.includes("block") || lower.includes("card")) return "square";
  return "hex";
};

const extractMaskBounds = async (
  mask: PreparedImageInput,
  width: number,
  height: number,
): Promise<MaskBounds> => {
  const maskRender = sharp(mask.buffer, { failOn: "none" })
    .resize(width, height, { fit: "fill" })
    .ensureAlpha();
  const { data, info } = await maskRender
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let covered = 0;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const luminance = info.channels >= 3
        ? Math.max(data[offset], data[offset + 1], data[offset + 2])
        : data[offset];
      if (luminance < 24) continue;
      covered += 1;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top || covered <= 0) {
    throw new Error("Mask is empty");
  }

  const maskPngBuffer = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    coverage: covered / (info.width * info.height),
    maskPngBuffer,
  };
};

const estimateTextWidth = (text: string, fontSize: number, weight: number): number => {
  const normalized = text.trim() || "M";
  const factor = weight >= 700 ? 0.74 : 0.64;
  return normalized.length * fontSize * factor;
};

const fitTextFontSize = (
  lines: string[],
  bounds: MaskBounds,
  weight: number,
): number => {
  const maxWidth = Math.max(24, bounds.width - 20);
  const maxHeight = Math.max(24, bounds.height - 18);
  const maxCandidate = Math.min(maxHeight / (Math.max(lines.length, 1) * 1.35), 116);

  for (let size = Math.floor(maxCandidate); size >= 12; size -= 1) {
    const widest = Math.max(...lines.map((line) => estimateTextWidth(line, size, weight)));
    const height = lines.length * size * 1.16;
    if (widest <= maxWidth && height <= maxHeight) {
      return size;
    }
  }

  return 12;
};

export const runMaskedTextInsertWorkflow = async (options: {
  source: string;
  mask: string;
  text?: string;
  style?: string;
  prompt?: string;
  filenameStem?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const source = await prepareImageInput(options.source);
  const mask = await prepareImageInput(options.mask);
  const metadata = await sharp(source.buffer, { failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error("Unable to read source image size");
  }

  const bounds = await extractMaskBounds(mask, width, height);
  const lines = (options.text?.trim() || "MOSS")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (lines.length === 0) {
    throw new Error("Exact text is required");
  }
  const style = textStyleSpec(options.style || "", options.prompt || "");
  const fontSize = fitTextFontSize(lines, bounds, style.weight);
  const lineHeight = fontSize * 1.16;
  const totalTextHeight = lines.length * lineHeight;
  const centerX = bounds.left + bounds.width / 2;
  const startY = bounds.top + (bounds.height - totalTextHeight) / 2 + fontSize * 0.84;
  const textColor = style.fill;
  const strokeColor = textColor === "#05070b" ? "rgba(255,255,255,0.55)" : "rgba(5,7,11,0.58)";
  const shadowBlock = style.shadow
    ? `<filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
         <feDropShadow dx="0" dy="${Math.max(2, Math.round(fontSize * 0.08))}" stdDeviation="${Math.max(2, Math.round(fontSize * 0.12))}" flood-color="${style.glow ? textColor : "#05070b"}" flood-opacity="${style.glow ? 0.42 : 0.35}" />
       </filter>`
    : "";
  const clipPath = `<clipPath id="maskTextClip"><rect x="${bounds.left}" y="${bounds.top}" width="${bounds.width}" height="${bounds.height}" rx="${Math.max(8, Math.min(24, bounds.height * 0.18))}" /></clipPath>`;
  const tspans = lines
    .map((line, index) => {
      const y = startY + index * lineHeight;
      return `<tspan x="${centerX}" y="${y}">${escapeSvgText(line)}</tspan>`;
    })
    .join("");
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>${shadowBlock}${clipPath}</defs>
      <g clip-path="url(#maskTextClip)" ${style.shadow ? 'filter="url(#shadow)"' : ""}>
        <text
          x="${centerX}"
          y="${startY}"
          text-anchor="middle"
          font-family="${style.family}"
          font-size="${fontSize}"
          font-weight="${style.weight}"
          font-style="${style.italic ? "italic" : "normal"}"
          letter-spacing="${Math.max(0, fontSize * 0.02)}"
          fill="${textColor}"
          stroke="${strokeColor}"
          stroke-width="${Math.max(0.8, fontSize * 0.045)}"
          paint-order="stroke fill"
        >${tspans}</text>
      </g>
    </svg>
  `;

  const composite = await sharp(source.buffer, { failOn: "none" })
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .png()
    .toBuffer();

  return persistBinaryImage(
    {
      buffer: composite,
      contentType: "image/png",
      ext: "png",
    },
    options.filenameStem || safeStem(source.filename, "text-insert"),
    {
      detailText: "Masked text insert",
      strategy: "svg_masked_text_insert",
      extra: {
        text: options.text?.trim() || "MOSS",
        style: options.style?.trim() || "",
        coverage: bounds.coverage,
      },
    },
  );
};

export const runReferenceReplaceWorkflow = async (options: {
  source: string;
  mask: string;
  referenceImage: string;
  prompt?: string;
  filenameStem?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const source = await prepareImageInput(options.source);
  const mask = await prepareImageInput(options.mask);
  const reference = await prepareImageInput(options.referenceImage);
  const metadata = await sharp(source.buffer, { failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error("Unable to read source image size");
  }

  const bounds = await extractMaskBounds(mask, width, height);
  const cleared = await runIOPaintInpaint({
    image: source.dataUrl,
    mask: bufferToDataUrl(bounds.maskPngBuffer, "image/png"),
    prompt: options.prompt?.trim() || "Remove the masked object and reconstruct the background naturally.",
    negative_prompt: "",
    hd_strategy: "Crop",
    hd_strategy_crop_trigger_size: 1024,
    hd_strategy_crop_margin: 128,
    sd_mask_blur: 8,
    sd_keep_unmasked_area: true,
  });

  const refContain = await sharp(reference.buffer, { failOn: "none" })
    .resize(bounds.width, bounds.height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const maskCrop = await sharp(bounds.maskPngBuffer, { failOn: "none" })
    .extract({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    })
    .removeAlpha()
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const referenceRaw = await sharp(refContain, { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const compositedRaw = Buffer.from(referenceRaw.data);
  for (let pixel = 0; pixel < bounds.width * bounds.height; pixel += 1) {
    const alpha = maskCrop.data[pixel] ?? 0;
    const offset = pixel * referenceRaw.info.channels;
    compositedRaw[offset + 3] = Math.min(compositedRaw[offset + 3], alpha);
  }

  const maskedReference = await sharp(compositedRaw, {
    raw: {
      width: bounds.width,
      height: bounds.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  const merged = await sharp(cleared.buffer, { failOn: "none" })
    .composite([
      {
        input: maskedReference,
        left: bounds.left,
        top: bounds.top,
      },
    ])
    .png()
    .toBuffer();

  return persistBinaryImage(
    {
      buffer: merged,
      contentType: "image/png",
      ext: "png",
    },
    options.filenameStem || safeStem(source.filename, "object-replaced"),
    {
      detailText: "Reference replace",
      strategy: "iopaint_reference_replace",
      extra: {
        coverage: bounds.coverage,
        prompt: options.prompt?.trim() || "",
      },
    },
  );
};

export const runPromptShapeReplaceWorkflow = async (options: {
  source: string;
  mask: string;
  prompt?: string;
  filenameStem?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const source = await prepareImageInput(options.source);
  const mask = await prepareImageInput(options.mask);
  const metadata = await sharp(source.buffer, { failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error("Unable to read source image size");
  }

  const bounds = await extractMaskBounds(mask, width, height);
  const cleared = await runIOPaintInpaint({
    image: source.dataUrl,
    mask: bufferToDataUrl(bounds.maskPngBuffer, "image/png"),
    prompt: "Remove the masked object and reconstruct the background naturally.",
    negative_prompt: "",
    hd_strategy: "Crop",
    hd_strategy_crop_trigger_size: 1024,
    hd_strategy_crop_margin: 128,
    sd_mask_blur: 8,
    sd_keep_unmasked_area: true,
  });

  const color = parseColorHint(options.prompt || "green");
  const shape = resolveShapeFromPrompt(options.prompt || "");
  const innerColor =
    color === "#5ef2a8" || color === "#7ce08f" ? "#15a86a" : "#ffffff";
  let shapeMarkup = "";
  if (shape === "circle") {
    shapeMarkup = `
      <circle cx="${bounds.left + bounds.width / 2}" cy="${bounds.top + bounds.height / 2}" r="${Math.min(bounds.width, bounds.height) * 0.34}" fill="${color}" />
      <circle cx="${bounds.left + bounds.width / 2}" cy="${bounds.top + bounds.height / 2}" r="${Math.min(bounds.width, bounds.height) * 0.18}" fill="${innerColor}" fill-opacity="0.25" />
    `;
  } else if (shape === "triangle") {
    const cx = bounds.left + bounds.width / 2;
    const topY = bounds.top + bounds.height * 0.18;
    const leftX = bounds.left + bounds.width * 0.22;
    const rightX = bounds.left + bounds.width * 0.78;
    const bottomY = bounds.top + bounds.height * 0.82;
    shapeMarkup = `<path d="M ${cx} ${topY} L ${rightX} ${bottomY} L ${leftX} ${bottomY} Z" fill="${color}" />`;
  } else if (shape === "square") {
    shapeMarkup = `
      <rect x="${bounds.left + bounds.width * 0.2}" y="${bounds.top + bounds.height * 0.2}" width="${bounds.width * 0.6}" height="${bounds.height * 0.6}" rx="${Math.min(bounds.width, bounds.height) * 0.12}" fill="${color}" />
      <rect x="${bounds.left + bounds.width * 0.3}" y="${bounds.top + bounds.height * 0.3}" width="${bounds.width * 0.4}" height="${bounds.height * 0.4}" rx="${Math.min(bounds.width, bounds.height) * 0.08}" fill="${innerColor}" fill-opacity="0.3" />
    `;
  } else {
    const cx = bounds.left + bounds.width / 2;
    const cy = bounds.top + bounds.height / 2;
    const rx = bounds.width * 0.34;
    const ry = bounds.height * 0.34;
    shapeMarkup = `
      <path d="M ${cx} ${cy - ry} L ${cx + rx * 0.82} ${cy - ry * 0.45} L ${cx + rx * 0.82} ${cy + ry * 0.45} L ${cx} ${cy + ry} L ${cx - rx * 0.82} ${cy + ry * 0.45} L ${cx - rx * 0.82} ${cy - ry * 0.45} Z" fill="${color}" />
      <path d="M ${cx} ${cy - ry * 0.62} L ${cx + rx * 0.46} ${cy - ry * 0.26} L ${cx + rx * 0.46} ${cy + ry * 0.26} L ${cx} ${cy + ry * 0.62} L ${cx - rx * 0.46} ${cy + ry * 0.26} L ${cx - rx * 0.46} ${cy - ry * 0.26} Z" fill="${innerColor}" fill-opacity="0.24" />
    `;
  }

  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g filter="url(#shadow)">
        ${shapeMarkup}
      </g>
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="${color}" flood-opacity="0.18" />
        </filter>
      </defs>
    </svg>
  `;

  const merged = await sharp(cleared.buffer, { failOn: "none" })
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .png()
    .toBuffer();

  return persistBinaryImage(
    {
      buffer: merged,
      contentType: "image/png",
      ext: "png",
    },
    options.filenameStem || safeStem(source.filename, "object-replaced"),
    {
      detailText: "Prompt replace",
      strategy: "svg_prompt_replace",
      extra: {
        coverage: bounds.coverage,
        prompt: options.prompt?.trim() || "",
      },
    },
  );
};

const ensurePluginModel = async (
  pluginName: string,
  modelName?: string,
): Promise<void> => {
  if (!modelName?.trim()) return;
  await switchIOPaintPluginModel(pluginName, modelName.trim());
};

const maybeSwitchModel = async (modelName?: string): Promise<void> => {
  if (!modelName?.trim()) return;
  await switchIOPaintModel(modelName.trim());
};

const parseScale = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(4, numeric));
};

export const runIOPaintPluginWorkflow = async (options: {
  source: string;
  pluginName: string;
  pluginModel?: string;
  model?: string;
  scale?: number;
  fallbackStem?: string;
  filenameStem?: string;
  detailText?: string;
  extra?: Record<string, unknown>;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const source = await prepareImageInput(options.source);
  await maybeSwitchModel(options.model);
  await ensurePluginModel(options.pluginName, options.pluginModel);
  const payload: IOPaintRunPluginPayload = {
    name: options.pluginName,
    image: source.dataUrl,
    scale: parseScale(options.scale, 2),
  };
  const binary = await runIOPaintPluginImage(payload);
  return persistBinaryImage(
    binary,
    options.filenameStem || safeStem(source.filename, options.fallbackStem || "image"),
    {
      detailText: options.detailText,
      strategy: options.pluginName.toLowerCase(),
      extra: options.extra,
    },
  );
};

export const runIOPaintMaskWorkflow = async (options: {
  source: string;
  pluginName: string;
  pluginModel?: string;
  clicks?: number[][];
  fallbackStem?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const source = await prepareImageInput(options.source);
  await ensurePluginModel(options.pluginName, options.pluginModel);
  const binary = await runIOPaintPluginMask({
    name: options.pluginName,
    image: source.dataUrl,
    clicks: options.clicks ?? [],
  });
  return persistBinaryImage(
    binary,
    `${options.fallbackStem || safeStem(source.filename, "mask")}-mask`,
    {
      detailText: options.pluginName,
      strategy: `${options.pluginName.toLowerCase()}_mask`,
    },
  );
};

export const runIOPaintInpaintWorkflow = async (options: {
  source: string;
  mask: string;
  model?: string;
  filenameStem?: string;
  detailText?: string;
  strategy?: string;
  payload?: Record<string, unknown>;
  outputExtra?: Record<string, unknown>;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const source = await prepareImageInput(options.source);
  const mask = await prepareImageInput(options.mask);
  await maybeSwitchModel(options.model);
  const payload: IOPaintInpaintPayload = {
    image: source.dataUrl,
    mask: mask.dataUrl,
    hd_strategy: "Crop",
    hd_strategy_crop_trigger_size: 1024,
    hd_strategy_crop_margin: 128,
    sd_mask_blur: 8,
    sd_keep_unmasked_area: true,
    ...(options.payload ?? {}),
  };
  const binary = await runIOPaintInpaint(payload);
  return persistBinaryImage(
    binary,
    options.filenameStem || safeStem(source.filename, "edited"),
    {
      detailText: options.detailText,
      strategy: options.strategy || "iopaint_inpaint",
      extra: options.outputExtra,
    },
  );
};

const normalizeCoverage = (value: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

type WatermarkCornerPlacement =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

const normalizeWatermarkPlacement = (
  value: string | undefined,
): WatermarkCornerPlacement | null => {
  const input = value?.trim().toLowerCase() || "";
  if (input === "top-left") return "top-left";
  if (input === "top-right") return "top-right";
  if (input === "bottom-left") return "bottom-left";
  if (input === "bottom-right") return "bottom-right";
  return null;
};

const watermarkCornerBounds = (
  width: number,
  height: number,
  placement: WatermarkCornerPlacement,
): { left: number; top: number; right: number; bottom: number } => {
  const regionWidth = Math.min(width, Math.max(120, Math.round(width * 0.46)));
  const regionHeight = Math.min(height, Math.max(52, Math.round(height * 0.18)));
  const left = placement.includes("right") ? width - regionWidth : 0;
  const top = placement.includes("bottom") ? height - regionHeight : 0;
  return {
    left,
    top,
    right: Math.min(width - 1, left + regionWidth - 1),
    bottom: Math.min(height - 1, top + regionHeight - 1),
  };
};

const constrainWatermarkMaskToPlacement = async (
  maskBuffer: Buffer,
  width: number,
  height: number,
  placement: WatermarkCornerPlacement,
): Promise<{ buffer: Buffer; coverage: number }> => {
  const corner = watermarkCornerBounds(width, height, placement);
  const { data, info } = await sharp(maskBuffer, { failOn: "none" })
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const restricted = Buffer.alloc(width * height, 0);
  let covered = 0;
  for (let y = corner.top; y <= corner.bottom; y += 1) {
    for (let x = corner.left; x <= corner.right; x += 1) {
      const sourceOffset = (y * width + x) * info.channels;
      const value = data[sourceOffset];
      if (value < 24) continue;
      restricted[y * width + x] = 255;
      covered += 1;
    }
  }

  const png = await sharp(restricted, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .png()
    .toBuffer();

  return {
    buffer: Buffer.from(png),
    coverage: covered / Math.max(1, width * height),
  };
};

export const runWatermarkRemovalWorkflow = async (options: {
  source: string;
  placement?: string;
  expandKernel?: number;
  model?: string;
  taskPrompt?: string;
  textInput?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
  maskUrl: string;
}> => {
  const source = await prepareImageInput(options.source);
  const maskPath = tempImagePath("png");
  const detection = await detectRemwmMask({
    image_path: source.path,
    save_mask_path: maskPath,
    task_prompt: options.taskPrompt || "<REGION_TO_SEGMENTATION>",
    text_input: options.textInput || "watermark",
  });
  if (!detection.ok || !detection.mask_path) {
    throw new Error("rem-wm did not produce a watermark mask");
  }
  const metadata = await sharp(source.buffer, { failOn: "none" }).metadata();
  const width = metadata.width ?? detection.width ?? 0;
  const height = metadata.height ?? detection.height ?? 0;
  if (!width || !height) {
    throw new Error("Unable to read source dimensions for watermark cleanup");
  }

  const placementHint = normalizeWatermarkPlacement(options.placement);
  let maskBuffer: Buffer = Buffer.from(readFileSync(detection.mask_path));
  let coverage = normalizeCoverage(detection.coverage);
  if (placementHint) {
    const constrained = await constrainWatermarkMaskToPlacement(
      maskBuffer,
      width,
      height,
      placementHint,
    );
    maskBuffer = Buffer.from(constrained.buffer);
    coverage = constrained.coverage;
  }

  if (detection.polygon_count <= 0 || coverage <= 0.0002) {
    throw new Error("rem-wm could not find a reliable watermark region");
  }

  const adjustedMask = await runIOPaintAdjustMask({
    mask: bufferToDataUrl(maskBuffer, "image/png"),
    operate: "expand",
    kernel_size: Math.max(3, Math.min(31, options.expandKernel ?? 9)),
  });
  const persistedMask = await persistBinaryImage(adjustedMask, `${safeStem(source.filename, "watermark")}-mask`, {
    detailText: "Watermark mask",
    strategy: "remwm_mask",
    extra: {
      coverage,
      polygon_count: detection.polygon_count,
      placement: options.placement || "auto",
    },
  });

  const restored = await runIOPaintInpaintWorkflow({
    source: source.path,
    mask: persistedMask.path,
    model: options.model,
    filenameStem: safeStem(source.filename, "watermark-free"),
    detailText: `rem-wm + IOPaint | ${Math.round(coverage * 1000) / 10}% mask`,
    strategy: "remwm_iopaint",
    payload: {
      prompt: "",
      negative_prompt: "",
      hd_strategy: "Crop",
      hd_strategy_crop_trigger_size: 1024,
      hd_strategy_crop_margin: 128,
      sd_mask_blur: 10,
      sd_keep_unmasked_area: true,
      cv2_radius: 4,
    },
    outputExtra: {
      placement: options.placement || "auto",
    },
  });

  return {
    ...restored,
    maskUrl: persistedMask.publicUrl,
    output: {
      ...restored.output,
      mask_url: persistedMask.publicUrl,
      polygon_count: detection.polygon_count,
      coverage,
    },
  };
};

export const runBatchWatermarkRemovalWorkflow = async (options: {
  sources: string[];
  placement?: string;
  expandKernel?: number;
  model?: string;
}): Promise<Array<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}>> => {
  const prepared = await Promise.all(options.sources.map((source) => prepareImageInput(source)));
  const maskDir = join(tmpdir(), `omni-remwm-batch-${randomUUID()}`);
  const detections = await detectRemwmMaskBatch({
    image_paths: prepared.map((item) => item.path),
    output_dir: maskDir,
  });
  const detectionByPath = new Map(detections.items.map((item) => [item.image_path, item]));
  const results: Array<{
    path: string;
    publicUrl: string;
    output: Record<string, unknown>;
  }> = [];

  for (const item of prepared) {
    const detection = detectionByPath.get(item.path);
    if (!detection?.mask_path || detection.polygon_count <= 0 || normalizeCoverage(detection.coverage) <= 0.0002) {
      throw new Error(`rem-wm could not build a mask for ${item.filename}`);
    }
    const adjustedMask = await runIOPaintAdjustMask({
      mask: bufferToDataUrl(readFileSync(detection.mask_path), "image/png"),
      operate: "expand",
      kernel_size: Math.max(3, Math.min(31, options.expandKernel ?? 9)),
    });
    const persistedMask = await persistBinaryImage(
      adjustedMask,
      `${safeStem(item.filename, "watermark")}-mask`,
      { detailText: "Watermark mask", strategy: "remwm_mask" },
    );
    const restored = await runIOPaintInpaintWorkflow({
      source: item.path,
      mask: persistedMask.path,
      model: options.model,
      filenameStem: safeStem(item.filename, "watermark-free"),
      detailText: `rem-wm + IOPaint | ${Math.round(normalizeCoverage(detection.coverage) * 1000) / 10}% mask`,
      strategy: "remwm_iopaint_batch",
      payload: {
        prompt: "",
        negative_prompt: "",
        hd_strategy: "Crop",
        hd_strategy_crop_trigger_size: 1024,
        hd_strategy_crop_margin: 128,
        sd_mask_blur: 10,
        sd_keep_unmasked_area: true,
      },
      outputExtra: {
        coverage: normalizeCoverage(detection.coverage),
        polygon_count: detection.polygon_count,
      },
    });
    results.push(restored);
  }

  return results;
};

export const runBackgroundRemovalWorkflow = async (options: {
  source: string;
  pluginModel?: string;
  model?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> =>
  runIOPaintPluginWorkflow({
    source: options.source,
    pluginName: "RemoveBG",
    pluginModel: options.pluginModel,
    model: options.model,
    filenameStem: safeStem(filenameFromInput(options.source, "cutout"), "cutout"),
    detailText: options.pluginModel?.trim() || "IOPaint RemoveBG",
    extra: {
      plugin: "RemoveBG",
      plugin_model: options.pluginModel,
    },
  });

export const runUpscaleWorkflow = async (options: {
  source: string;
  scale?: number;
  pluginModel?: string;
  model?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> =>
  runIOPaintPluginWorkflow({
    source: options.source,
    pluginName: "RealESRGAN",
    pluginModel: options.pluginModel,
    model: options.model,
    scale: parseScale(options.scale, 2),
    filenameStem: safeStem(filenameFromInput(options.source, "upscaled"), "upscaled"),
    detailText: `${options.pluginModel?.trim() || "RealESRGAN"} | ${parseScale(options.scale, 2)}x`,
    extra: {
      plugin: "RealESRGAN",
      plugin_model: options.pluginModel,
      scale: parseScale(options.scale, 2),
    },
  });

export const runFaceRestoreWorkflow = async (options: {
  source: string;
  engine?: "GFPGAN" | "RestoreFormer";
  model?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const pluginName = options.engine === "RestoreFormer" ? "RestoreFormer" : "GFPGAN";
  return runIOPaintPluginWorkflow({
    source: options.source,
    pluginName,
    model: options.model,
    filenameStem: safeStem(filenameFromInput(options.source, "face-restored"), "face-restored"),
    detailText: pluginName,
    extra: {
      plugin: pluginName,
    },
  });
};

export const buildOutpaintInputs = async (options: {
  source: string;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}): Promise<{
  imagePath: string;
  maskPath: string;
  width: number;
  height: number;
}> => {
  const prepared = await prepareImageInput(options.source);
  const metadata = await sharp(prepared.buffer, { failOn: "none" }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error("Unable to read source image dimensions");
  }
  const top = Math.max(0, Math.floor(options.top ?? 0));
  const right = Math.max(0, Math.floor(options.right ?? 0));
  const bottom = Math.max(0, Math.floor(options.bottom ?? 0));
  const left = Math.max(0, Math.floor(options.left ?? 0));
  const expandedWidth = width + left + right;
  const expandedHeight = height + top + bottom;

  const imageBuffer = await sharp(prepared.buffer, { failOn: "none" })
    .ensureAlpha()
    .extend({
      top,
      right,
      bottom,
      left,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const mask = Buffer.alloc(expandedWidth * expandedHeight, 255);
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      mask[y * expandedWidth + x] = 0;
    }
  }
  const maskBuffer = await sharp(mask, {
    raw: { width: expandedWidth, height: expandedHeight, channels: 1 },
  })
    .png()
    .toBuffer();

  const imagePath = tempImagePath("png");
  const maskPath = tempImagePath("png");
  writeFileSync(imagePath, imageBuffer);
  writeFileSync(maskPath, maskBuffer);

  return { imagePath, maskPath, width: expandedWidth, height: expandedHeight };
};

export const runOutpaintWorkflow = async (options: {
  source: string;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  model?: string;
  payload?: Record<string, unknown>;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const expanded = await buildOutpaintInputs(options);
  const detailText = `Outpaint | T${options.top ?? 0} R${options.right ?? 0} B${options.bottom ?? 0} L${options.left ?? 0}`;
  return runIOPaintInpaintWorkflow({
    source: expanded.imagePath,
    mask: expanded.maskPath,
    model: options.model,
    filenameStem: safeStem(filenameFromInput(options.source, "outpaint"), "outpaint"),
    detailText,
    strategy: "iopaint_outpaint",
    payload: {
      prompt: "",
      negative_prompt: "",
      hd_strategy: "Resize",
      hd_strategy_resize_limit: Math.max(expanded.width, expanded.height),
      sd_mask_blur: 16,
      sd_keep_unmasked_area: true,
      ...(options.payload ?? {}),
    },
  });
};

export const runImageFallback = async (options: {
  sourceUrl: string;
  prompt: string;
  extra?: Record<string, unknown>;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const result = await generateImage.handler({
    prompt: options.prompt,
    reference_image_url: options.sourceUrl,
    ...(options.extra ?? {}),
  });
  if (result.status !== "success" || !result.output_url) {
    throw new Error(result.error?.message || "AI fallback failed");
  }
  const publicUrl = looksLikeUrl(result.output_url)
    ? absoluteUrl(result.output_url)
    : register(result.output_url, String(result.output?.filename || basename(result.output_url)));
  return {
    path: result.output_url,
    publicUrl,
    output: {
      ...(result.output ?? {}),
      output_file_url: publicUrl,
      strategy: "ai_fallback",
    },
  };
};

type MaskedEditMode = "remove-object" | "replace-object" | "add-text";

const buildMaskedEditPrompt = (options: {
  mode: MaskedEditMode;
  prompt?: string;
  text?: string;
  style?: string;
  hasReference?: boolean;
}): string => {
  const userPrompt = options.prompt?.trim() || "";

  if (options.mode === "remove-object") {
    return userPrompt
      ? `Use the first image as the base image and the second image as the mask. Edit only the white masked region. Remove the masked object and reconstruct the original background naturally. Preserve everything outside the mask exactly. ${userPrompt}`
      : "Use the first image as the base image and the second image as the mask. Edit only the white masked region. Remove the masked object and reconstruct the original background naturally. Preserve everything outside the mask exactly.";
  }

  if (options.mode === "replace-object") {
    const replacementPrompt = userPrompt || "a refined replacement object";
    const referenceClause = options.hasReference
      ? "Use the optional third reference image to guide shape, material, and color."
      : "";
    return `Use the first image as the base image and the second image as the mask. Edit only the white masked region. Replace the masked object with ${replacementPrompt}. Preserve camera angle, lighting, composition, and everything outside the mask exactly. ${referenceClause}`.trim();
  }

  const textValue = options.text?.trim() || "MOSS";
  const styleValue = options.style?.trim() || "bold white sans-serif poster lettering";
  const extraPrompt = userPrompt ? ` ${userPrompt}` : "";
  return `Use the first image as the base image and the second image as the mask. Edit only the white masked region. Insert the exact text "${textValue}" inside the masked area. Match the composition and perspective of the original image. Typography style: ${styleValue}.${extraPrompt}`;
};

export const runMaskedEditFallback = async (options: {
  source: string;
  mask: string;
  mode: MaskedEditMode;
  prompt?: string;
  text?: string;
  style?: string;
  referenceImage?: string;
  filenameStem?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const source = await prepareImageInput(options.source);
  const mask = await prepareImageInput(options.mask);
  const metadata = await sharp(source.buffer, { failOn: "none" }).metadata();
  const aspectRatio = nearestSupportedAspectRatio(metadata.width ?? 1, metadata.height ?? 1);
  const references = [source.dataUrl, mask.dataUrl];
  if (options.referenceImage?.trim()) {
    const reference = await prepareImageInput(options.referenceImage);
    references.push(reference.dataUrl);
  }

  const result = await generateImage.handler({
    prompt: buildMaskedEditPrompt({
      mode: options.mode,
      prompt: options.prompt,
      text: options.text,
      style: options.style,
      hasReference: Boolean(options.referenceImage?.trim()),
    }),
    reference_image_urls: references,
    aspect_ratio: aspectRatio,
  });

  const detailText =
    options.mode === "add-text"
      ? "AI masked text insert"
      : options.mode === "replace-object"
        ? "AI masked replacement"
        : "AI masked object removal";

  return normalizeGeneratedImageResult(result, {
    filenameStem: options.filenameStem || safeStem(source.filename, "edited"),
    strategy: `ai_masked_${options.mode.replace(/-/g, "_")}`,
    detailText,
    extra: {
      mode: options.mode,
      mask_applied: true,
    },
  });
};

export const runPromptedOutpaintFallback = async (options: {
  source: string;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  prompt?: string;
  filenameStem?: string;
}): Promise<{
  path: string;
  publicUrl: string;
  output: Record<string, unknown>;
}> => {
  const expanded = await buildOutpaintInputs(options);
  const expandedImage = bufferToDataUrl(readFileSync(expanded.imagePath), "image/png");
  const expandedMask = bufferToDataUrl(readFileSync(expanded.maskPath), "image/png");
  const aspectRatio = nearestSupportedAspectRatio(expanded.width, expanded.height);
  const prompt = options.prompt?.trim()
    ? `Use the first image as the expanded canvas and the second image as the editable mask. Fill only the white masked area and preserve the original pixels exactly. ${options.prompt.trim()}`
    : "Use the first image as the expanded canvas and the second image as the editable mask. Fill only the white masked area and preserve the original pixels exactly. Extend the scene naturally beyond the original frame.";

  const result = await generateImage.handler({
    prompt,
    reference_image_urls: [expandedImage, expandedMask],
    aspect_ratio: aspectRatio,
  });

  return normalizeGeneratedImageResult(result, {
    filenameStem:
      options.filenameStem || safeStem(filenameFromInput(options.source, "outpaint"), "outpaint"),
    strategy: "ai_masked_outpaint",
    detailText: `AI outpaint | T${options.top ?? 0} R${options.right ?? 0} B${options.bottom ?? 0} L${options.left ?? 0}`,
    extra: {
      top: options.top ?? 0,
      right: options.right ?? 0,
      bottom: options.bottom ?? 0,
      left: options.left ?? 0,
      mask_applied: true,
    },
  });
};

export const fileUrlToDataUrl = async (input: string): Promise<string> => {
  if (input.startsWith("data:")) return input;
  if (!looksLikeUrl(input)) {
    const prepared = await prepareImageInput(input);
    return prepared.dataUrl;
  }
  return imageUrlToDataUrl(absoluteUrl(input));
};
