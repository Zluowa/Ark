// @input: prompt + optional reference image URLs
// @output: generated image file URL (supports text-to-image and image-to-image)
// @position: AI image-generation tool (Gemini image preview via i-helios relay)

import { writeFileSync } from "node:fs";
import { extname } from "node:path";
import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";
import { LONG_TIMEOUT_MS } from "@/lib/engine/types";
import { downloadFile, tempFile } from "./helpers";

const ok = (
  data: Record<string, unknown>,
  outputUrl: string,
  start: number,
): ReturnType<ToolHandler> =>
  Promise.resolve({
    status: "success",
    output: data,
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

type GeminiPart = {
  text?: string;
  thought?: boolean;
  inlineData?: { data?: string; mimeType?: string };
  inline_data?: { data?: string; mime_type?: string };
  fileData?: { fileUri?: string; mimeType?: string };
  file_data?: { file_uri?: string; mime_type?: string };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message?: string };
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
            image_url?: { url?: string };
          }>;
    };
  }>;
  error?: { message?: string };
};

type ChatMessageContent =
  | string
  | Array<{
      type?: string;
      text?: string;
      image_url?: { url?: string };
    }>;

const DEFAULT_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_BASE_URL = "https://i-helios.top";

const STYLE_PREFIXES: Record<string, string> = {
  realistic: "photorealistic, high quality,",
  illustration: "digital illustration, artistic style,",
  "3d": "3D render, cinematic lighting,",
  pixel: "pixel art, retro 16-bit style,",
};

const SUPPORTED_ASPECT_RATIOS = [
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

const SIZE_TO_ASPECT_RATIO: Record<string, string> = {
  "1024x1024": "1:1",
  "1024x1792": "9:16",
  "1792x1024": "16:9",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (
  input: RequestInfo | URL,
  init: RequestInit,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<Response> => {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const baseDelayMs = Math.max(100, options?.baseDelayMs ?? 1000);
  let lastError: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(input, init);
      if (!RETRYABLE_HTTP_STATUS.has(response.status) || i === attempts - 1) {
        return response;
      }
      lastError = new Error(`retryable_status_${response.status}`);
    } catch (error) {
      lastError = error;
      if (i === attempts - 1) break;
    }
    await sleep(baseDelayMs * (i + 1));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("fetch failed");
};

const clean = (value: unknown): string => String(value ?? "").trim();

const normalizeBaseUrl = (value: string): string => {
  let url = value.trim().replace(/\/+$/, "");
  url = url.replace(/\/v1$/, "");
  url = url.replace(/\/v1beta$/, "");
  return url || DEFAULT_BASE_URL;
};

const normalizeAspectRatio = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  const allowed = new Set<string>(SUPPORTED_ASPECT_RATIOS);
  return allowed.has(normalized) ? normalized : "1:1";
};

const extractAspectRatioFromPrompt = (promptText: string): string | undefined => {
  const normalizedText = promptText
    .replace(/\uFF1A/g, ":")
    .replace(/(\d+)\s*[xX*]\s*(\d+)/g, "$1:$2")
    .replace(/(\d+)\s*\u6BD4\s*(\d+)/g, "$1:$2");

  const explicitMatch = normalizedText.match(
    /\b(1:1|16:9|9:16|4:3|3:4|3:2|2:3|5:4|4:5|21:9|9:21)\b/i,
  );
  if (explicitMatch) {
    return normalizeAspectRatio(explicitMatch[1]);
  }

  const aliasMatch = normalizedText.match(/\b(square|landscape|portrait)\b/i);
  if (!aliasMatch) return undefined;

  const alias = aliasMatch[1].toLowerCase();
  if (alias === "square") return "1:1";
  if (alias === "landscape") return "16:9";
  if (alias === "portrait") return "9:16";
  return undefined;
};

const normalizeResolution = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "1K" || normalized.includes("1024")) return "1K";
  if (normalized === "2K" || normalized.includes("2048")) return "2K";
  if (normalized === "3K" || normalized.includes("3072")) return "3K";
  if (normalized === "4K" || normalized.includes("4096")) return "4K";
  return "1K";
};

const parseReferenceImageUrls = (params: Record<string, unknown>): string[] => {
  const urls: string[] = [];
  const pushUnique = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!urls.includes(trimmed)) urls.push(trimmed);
  };

  for (const key of [
    "reference_image_url",
    "referenceImageUrl",
    "image_url",
    "imageUrl",
    "file_url",
  ]) {
    const value = clean(params[key]);
    if (value) pushUnique(value);
  }

  for (const key of ["reference_image_urls", "referenceImageUrls", "reference_images"]) {
    const raw = params[key];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") pushUnique(item);
      }
      continue;
    }
    const text = clean(raw);
    if (!text) continue;

    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string") pushUnique(item);
          }
          continue;
        }
      } catch {
        // fall back to comma split
      }
    }

    for (const item of text.split(/[,\n]/g)) {
      pushUnique(item);
    }
  }

  return urls.slice(0, 6);
};

const parseDataUrl = (
  value: string,
): { mime: string; base64: string } | undefined => {
  const match = value.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return undefined;
  return { mime: match[1].toLowerCase(), base64: match[2] };
};

const urlExt = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    const extension = extname(parsed.pathname).replace(/^\./, "").toLowerCase();
    return extension || undefined;
  } catch {
    return undefined;
  }
};

const extFromMime = (mime: string | undefined): string => {
  const normalized = (mime ?? "").toLowerCase().trim();
  return MIME_TO_EXT[normalized] ?? "png";
};

const toInlinePart = async (url: string): Promise<{ inlineData: { mimeType: string; data: string } }> => {
  const dataUrl = parseDataUrl(url);
  if (dataUrl) {
    return {
      inlineData: {
        mimeType: dataUrl.mime || "image/png",
        data: dataUrl.base64,
      },
    };
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch reference image: ${response.status}`);
  }
  const mimeType =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ||
    "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    inlineData: {
      mimeType,
      data: bytes.toString("base64"),
    },
  };
};

const allParts = (data: GeminiResponse): GeminiPart[] => {
  const output: GeminiPart[] = [];
  for (const candidate of data.candidates ?? []) {
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) output.push(...parts);
  }
  return output;
};

const inlineDataOf = (
  part: GeminiPart,
): { data?: string; mimeType?: string } | undefined =>
  part.inlineData ??
  (part.inline_data
    ? {
        data: part.inline_data.data,
        mimeType: part.inline_data.mime_type,
      }
    : undefined);

const fileDataOf = (
  part: GeminiPart,
): { fileUri?: string; mimeType?: string } | undefined =>
  part.fileData ??
  (part.file_data
    ? {
        fileUri: part.file_data.file_uri,
        mimeType: part.file_data.mime_type,
      }
    : undefined);

const persistFromInlineData = (mime: string | undefined, base64: string): string => {
  const ext = extFromMime(mime);
  const filePath = tempFile(ext);
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filePath;
};

const persistFromUrl = async (
  fileUri: string,
  mime: string | undefined,
): Promise<string> => {
  const buffer = await downloadFile(fileUri);
  const ext = extFromMime(mime) || urlExt(fileUri) || "png";
  const filePath = tempFile(ext);
  writeFileSync(filePath, buffer);
  return filePath;
};

const extractUrlFromMarkdownImage = (value: string): string | undefined => {
  const match = value.match(/!\[[^\]]*]\(([^)]+)\)/);
  return match?.[1]?.trim();
};

const extractImageUrlFromChatContent = (
  content: ChatMessageContent | undefined,
): string | undefined => {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) return undefined;
    if (
      trimmed.startsWith("data:image/") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://")
    ) {
      return trimmed;
    }
    return extractUrlFromMarkdownImage(trimmed);
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part?.text === "string") {
        const fromText = extractImageUrlFromChatContent(part.text);
        if (fromText) return fromText;
      }
      const imageUrl = part?.image_url?.url?.trim();
      if (imageUrl) return imageUrl;
    }
  }

  return undefined;
};

const persistFromAnyImageUrl = async (value: string): Promise<string> => {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) return persistFromInlineData(dataUrl.mime, dataUrl.base64);
  return persistFromUrl(value, undefined);
};

const tryGenerateViaChatCompletions = async (args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  references: string[];
}): Promise<string | undefined> => {
  const endpoint = `${args.baseUrl}/v1/chat/completions`;
  const userContent =
    args.references.length > 0
      ? [
          { type: "text", text: args.prompt },
          ...args.references.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        ]
      : args.prompt;

  const body = JSON.stringify({
    model: args.model,
    messages: [{ role: "user", content: userContent }],
    stream: false,
  });
  const response = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(220_000),
    },
    { attempts: 2, baseDelayMs: 800 },
  );

  let data: ChatCompletionResponse | undefined;
  try {
    data = (await response.json()) as ChatCompletionResponse;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const errorMessage = data?.error?.message || `chat/completions ${response.status}`;
    throw new Error(errorMessage);
  }
  if (!data) return undefined;

  const content = data.choices?.[0]?.message?.content;
  const imageUrl = extractImageUrlFromChatContent(content);
  if (!imageUrl) return undefined;
  return persistFromAnyImageUrl(imageUrl);
};

const imageGenManifest: ToolManifest = {
  id: "generate.image",
  name: "AI Image Generator",
  description:
    "Generate images via Gemini Flash Image Preview. Supports text-to-image and image-to-image.",
  category: "generate",
  tags: ["image", "generate", "gemini", "text-to-image", "image-to-image"],
  params: [
    {
      name: "prompt",
      type: "string",
      required: true,
      description: "Describe the image to generate",
    },
    {
      name: "model",
      type: "string",
      required: false,
      default: DEFAULT_MODEL,
      description: "Model name",
    },
    {
      name: "style",
      type: "enum",
      required: false,
      default: "realistic",
      description: "Prompt style prefix",
      enum_values: ["realistic", "illustration", "3d", "pixel"],
    },
    {
      name: "aspect_ratio",
      type: "enum",
      required: false,
      default: "1:1",
      description: "Aspect ratio",
      enum_values: [...SUPPORTED_ASPECT_RATIOS],
    },
    {
      name: "resolution",
      type: "enum",
      required: false,
      default: "1K",
      description: "Output resolution bucket",
      enum_values: ["1K", "2K", "3K", "4K"],
    },
    {
      name: "reference_image_url",
      type: "file",
      required: false,
      description: "Reference image URL for image-to-image",
      accept: [".png", ".jpg", ".jpeg", ".webp"],
    },
    {
      name: "reference_image_urls",
      type: "string",
      required: false,
      description: "Multiple reference URLs as JSON array or comma-separated text",
    },
    {
      name: "reference_images",
      type: "string",
      required: false,
      description:
        "Alias of reference_image_urls (JSON array, comma-separated URLs, or data URLs)",
    },
    {
      name: "size",
      type: "enum",
      required: false,
      default: "1024x1024",
      description: "Legacy size option (maps to aspect_ratio)",
      enum_values: ["1024x1024", "1024x1792", "1792x1024"],
    },
  ],
    output_type: "file",
  keywords: [
    "generate image",
    "create image",
    "text to image",
    "image to image",
    "生图",
    "文生图",
    "图生图",
  ],
  patterns: [
    "generate.*image",
    "create.*image",
    "text.*to.*image",
    "image.*to.*image",
    "生图",
    "文生图",
    "图生图",
  ],
};
const imageGenHandler: ToolHandler = async (params) => {
  const start = Date.now();

  const apiKey =
    process.env.OMNIAGENT_IMAGE_API_KEY?.trim() ||
    process.env.OMNIAGENT_RELAY_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return fail(
      "NO_IMAGE_API_KEY",
      "Missing image API key. Set OMNIAGENT_IMAGE_API_KEY (or OMNIAGENT_RELAY_API_KEY).",
      start,
    );
  }

  const baseUrl = normalizeBaseUrl(
    clean(process.env.OMNIAGENT_IMAGE_BASE_URL) ||
      clean(process.env.OMNIAGENT_RELAY_BASE_URL) ||
      DEFAULT_BASE_URL,
  );

  const prompt = clean(params.prompt);
  if (!prompt) return fail("EMPTY_PROMPT", "Prompt cannot be empty", start);

  const model = clean(params.model) || clean(process.env.OMNIAGENT_IMAGE_MODEL) || DEFAULT_MODEL;
  const style = clean(params.style).toLowerCase();
  const prefix = STYLE_PREFIXES[style] ?? "";
  const fullPrompt = prefix ? `${prefix} ${prompt}` : prompt;

  const aspectRatioInput =
    clean(params.aspect_ratio) ||
    extractAspectRatioFromPrompt(prompt) ||
    SIZE_TO_ASPECT_RATIO[clean(params.size)] ||
    "1:1";
  const aspectRatio = normalizeAspectRatio(aspectRatioInput);
  const resolution = normalizeResolution(clean(params.resolution) || "1K");

  const referenceUrls = parseReferenceImageUrls(params);
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  try {
    const fromChatCompletions = await tryGenerateViaChatCompletions({
      apiKey,
      baseUrl,
      model,
      prompt: fullPrompt,
      references: referenceUrls,
    });
    if (fromChatCompletions) {
      return ok(
        {
          prompt,
          revised_prompt: fullPrompt,
          model,
          mode: referenceUrls.length > 0 ? "image_to_image" : "text_to_image",
          references_count: referenceUrls.length,
          aspect_ratio: aspectRatio,
          resolution,
          transport: "chat_completions",
          text: "Image generated successfully.",
        },
        fromChatCompletions,
        start,
      );
    }
  } catch {
    // Fallback to Gemini v1beta generateContent below.
  }

  try {
    for (const reference of referenceUrls) {
      parts.push(await toInlinePart(reference));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("BAD_REFERENCE_IMAGE", message, start);
  }

  parts.push({ text: fullPrompt });

  const endpoint =
    `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let response: Response;
  try {
    const body = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: resolution,
        },
      },
    });
    response = await fetchWithRetry(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(220_000),
      },
      { attempts: 3, baseDelayMs: 1200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("NETWORK_ERROR", `Image API request failed: ${message}`, start);
  }

  let data: GeminiResponse | undefined;
  try {
    data = (await response.json()) as GeminiResponse;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const errorMessage =
      data?.error?.message ||
      `Image API returned ${response.status}`;
    return fail("IMAGE_API_ERROR", errorMessage, start);
  }
  if (!data) {
    return fail("INVALID_RESPONSE", "Image API returned invalid JSON", start);
  }

  const partsOut = allParts(data);
  for (const part of partsOut) {
    if (part.thought) continue;

    const inline = inlineDataOf(part);
    if (inline?.data) {
      const localFile = persistFromInlineData(inline.mimeType, inline.data);
      return ok(
        {
          prompt,
          revised_prompt: fullPrompt,
          model,
          mode: referenceUrls.length > 0 ? "image_to_image" : "text_to_image",
          references_count: referenceUrls.length,
          aspect_ratio: aspectRatio,
          resolution,
          transport: "gemini_v1beta",
          text: "Image generated successfully.",
        },
        localFile,
        start,
      );
    }

    const fileData = fileDataOf(part);
    if (fileData?.fileUri) {
      try {
        const localFile = await persistFromUrl(fileData.fileUri, fileData.mimeType);
        return ok(
          {
            prompt,
            revised_prompt: fullPrompt,
            model,
            mode: referenceUrls.length > 0 ? "image_to_image" : "text_to_image",
            references_count: referenceUrls.length,
            aspect_ratio: aspectRatio,
            resolution,
            transport: "gemini_v1beta",
            text: "Image generated successfully.",
          },
          localFile,
          start,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail("DOWNLOAD_IMAGE_ERROR", message, start);
      }
    }
  }

  return fail("NO_IMAGE", "Model returned no image payload", start);
};

export const generateImage: ToolRegistryEntry = {
  manifest: imageGenManifest,
  handler: imageGenHandler,
  timeout: LONG_TIMEOUT_MS * 2,
};

