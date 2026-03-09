import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { authorizeRequest } from "@/lib/server/access-control";
import { withObservedRequest } from "@/lib/server/observability";
import { toResponse } from "@/lib/shared/result";
import { parseJsonBodyWithLimit } from "@/lib/server/security-controls";
import {
  bufferToDataUrl,
  ensureIOPaintService,
  fetchIOPaintCurrentModel,
  fetchIOPaintServerConfig,
  getIOPaintBaseUrl,
  runIOPaintAdjustMask,
  switchIOPaintModel,
  switchIOPaintPluginModel,
} from "@/lib/tools/iopaint-service";
import { detectRemwmMask, detectRemwmMaskBatch } from "@/lib/tools/remwm-service";
import {
  detectWatermarkMask,
  normalizePlacement,
} from "@/lib/tools/image";
import {
  prepareImageInput,
  runBackgroundRemovalWorkflow,
  runFaceRestoreWorkflow,
  runIOPaintInpaintWorkflow,
  runIOPaintMaskWorkflow,
  runIOPaintPluginWorkflow,
} from "@/lib/server/iopaint-workflows";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

type JsonBody = Record<string, unknown>;

const readPath = async (context: RouteContext): Promise<string> => {
  const { path } = await context.params;
  return Array.isArray(path) ? path.join("/") : "";
};

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const requireSourceInput = (body: JsonBody): string => {
  const source =
    asString(body.image) ||
    asString(body.source) ||
    asString(body.file_url) ||
    asString(body.image_path);
  if (!source) {
    throw new Error("Missing source image");
  }
  return source;
};

const requireMaskInput = (body: JsonBody): string => {
  const mask = asString(body.mask) || asString(body.mask_url);
  if (!mask) {
    throw new Error("Missing mask image");
  }
  return mask;
};

const successResult = (result: Record<string, unknown>) =>
  Response.json({ ok: true, result });

const buildMaskDataUrl = async (
  mask: Uint8Array,
  width: number,
  height: number,
): Promise<string> => {
  const alpha = Uint8Array.from(mask, (value) => (value ? 255 : 0));
  const buffer = await sharp(Buffer.from(alpha), {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();
  return bufferToDataUrl(buffer, "image/png");
};

const resolveUpstreamPath = (path: string): string => {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "server-config";
  if (trimmed.startsWith("raw/")) {
    return trimmed.slice(4);
  }
  return trimmed.replace(/-/g, "_");
};

const forwardUpstream = async (req: Request, path: string): Promise<Response> => {
  await ensureIOPaintService();
  const upstreamPath = resolveUpstreamPath(path);
  const upstreamUrl = `${getIOPaintBaseUrl()}/api/v1/${upstreamPath}`;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Buffer.from(await req.arrayBuffer());
  }
  const upstream = await fetch(upstreamUrl, init);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
};

const withAuthorizedRoute = async (
  req: Request,
  route: string,
  handler: () => Promise<Response>,
): Promise<Response> =>
  withObservedRequest(req, {
    route,
    handler: async () => {
      const access = authorizeRequest(req, "execute:write");
      if (!access.ok) {
        return toResponse(access);
      }
      return handler();
    },
  });

const runGet = async (req: Request, context: RouteContext): Promise<Response> => {
  const path = await readPath(context);
  if (path === "server-config") {
    const config = await fetchIOPaintServerConfig();
    return successResult(config as unknown as Record<string, unknown>);
  }
  if (path === "model") {
    const currentModel = await fetchIOPaintCurrentModel();
    return successResult(currentModel as unknown as Record<string, unknown>);
  }
  return forwardUpstream(req, path);
};

const runPost = async (req: Request, context: RouteContext): Promise<Response> => {
  const path = await readPath(context);
  const parsed = await parseJsonBodyWithLimit<JsonBody>(req, {
    route: `/api/iopaint/${path}`,
    maxBytes: 32 * 1024 * 1024,
  });
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.value;

  if (path === "model") {
    const name = asString(body.name);
    if (!name) {
      return Response.json({ ok: false, error: "Missing model name" }, { status: 400 });
    }
    const model = await switchIOPaintModel(name);
    return successResult(model as unknown as Record<string, unknown>);
  }

  if (path === "switch-plugin-model") {
    const pluginName = asString(body.plugin_name);
    const modelName = asString(body.model_name);
    if (!pluginName || !modelName) {
      return Response.json(
        { ok: false, error: "Missing plugin_name or model_name" },
        { status: 400 },
      );
    }
    await switchIOPaintPluginModel(pluginName, modelName);
    return successResult({ plugin_name: pluginName, model_name: modelName });
  }

  if (path === "inpaint") {
    const source = requireSourceInput(body);
    const mask = requireMaskInput(body);
    const { image, source: _source, file_url, image_path, mask: _mask, mask_url, model, filename_stem, detail_text, ...payload } = body;
    void image;
    void _source;
    void file_url;
    void image_path;
    void _mask;
    void mask_url;
    const result = await runIOPaintInpaintWorkflow({
      source,
      mask,
      model: asString(model),
      filenameStem: asString(filename_stem),
      detailText: asString(detail_text),
      payload,
    });
    return successResult({
      ...result.output,
      output_file_url: result.publicUrl,
      preview_url: result.publicUrl,
    });
  }

  if (path === "run-plugin-gen-image") {
    const source = requireSourceInput(body);
    const pluginName = asString(body.name);
    if (!pluginName) {
      return Response.json({ ok: false, error: "Missing plugin name" }, { status: 400 });
    }
    if (pluginName === "RemoveBG") {
      const result = await runBackgroundRemovalWorkflow({
        source,
        pluginModel: asString(body.plugin_model) || asString(body.model_name),
      });
      return successResult({
        ...result.output,
        output_file_url: result.publicUrl,
        preview_url: result.publicUrl,
      });
    }
    if (pluginName === "GFPGAN" || pluginName === "RestoreFormer") {
      const result = await runFaceRestoreWorkflow({
        source,
        engine: pluginName === "RestoreFormer" ? "RestoreFormer" : "GFPGAN",
      });
      return successResult({
        ...result.output,
        output_file_url: result.publicUrl,
        preview_url: result.publicUrl,
      });
    }
    const result = await runIOPaintPluginWorkflow({
      source,
      pluginName,
      pluginModel: asString(body.plugin_model) || asString(body.model_name),
      model: asString(body.model),
      scale: typeof body.scale === "number" ? body.scale : Number(body.scale ?? 2),
      filenameStem: asString(body.filename_stem),
      detailText: asString(body.detail_text),
      extra: body,
    });
    return successResult({
      ...result.output,
      output_file_url: result.publicUrl,
      preview_url: result.publicUrl,
    });
  }

  if (path === "run-plugin-gen-mask") {
    const source = requireSourceInput(body);
    const pluginName = asString(body.name);
    if (!pluginName) {
      return Response.json({ ok: false, error: "Missing plugin name" }, { status: 400 });
    }
    const clicks = Array.isArray(body.clicks)
      ? body.clicks.filter(Array.isArray) as number[][]
      : [];
    const result = await runIOPaintMaskWorkflow({
      source,
      pluginName,
      pluginModel: asString(body.plugin_model) || asString(body.model_name),
      clicks,
      fallbackStem: asString(body.filename_stem),
    });
    return successResult({
      ...result.output,
      output_file_url: result.publicUrl,
      preview_url: result.publicUrl,
    });
  }

  if (path === "adjust-mask") {
    const mask = requireMaskInput(body);
    const preparedMask = await prepareImageInput(mask);
    const adjusted = await runIOPaintAdjustMask({
      mask: preparedMask.dataUrl,
      operate:
        asString(body.operate) === "shrink"
          ? "shrink"
          : asString(body.operate) === "reverse"
            ? "reverse"
            : "expand",
      kernel_size:
        typeof body.kernel_size === "number"
          ? Math.max(3, Math.min(31, body.kernel_size))
          : 9,
    });
    return successResult({
      mask_data_url: bufferToDataUrl(adjusted.buffer, adjusted.contentType),
      size_bytes: adjusted.buffer.length,
      content_type: adjusted.contentType,
      seed: adjusted.seed,
    });
  }

  if (path === "remwm/detect-mask") {
    const source = requireSourceInput(body);
    const preparedSource = await prepareImageInput(source);
    const sourceMeta = await sharp(preparedSource.buffer, { failOn: "none" }).metadata();
    const sourceWidth = sourceMeta.width ?? 0;
    const sourceHeight = sourceMeta.height ?? 0;
    const classicPlacement = normalizePlacement(body.placement);
    const classicCandidate = await detectWatermarkMask(
      preparedSource.buffer,
      classicPlacement,
    );
    if (classicCandidate && classicCandidate.confidence >= 0.46) {
      let maskPixels = 0;
      for (const pixel of classicCandidate.mask) {
        maskPixels += pixel ? 1 : 0;
      }
      return successResult({
        ok: true,
        width: sourceWidth,
        height: sourceHeight,
        polygon_count: 1,
        coverage: maskPixels / Math.max(1, sourceWidth * sourceHeight),
        placement: classicCandidate.placement,
        confidence: classicCandidate.confidence,
        model_id: "classic-corner-mask",
        device: "cpu",
        engine: "traditional",
        mask_data_url: await buildMaskDataUrl(
          classicCandidate.mask,
          sourceWidth,
          sourceHeight,
        ),
      });
    }
    const saveMaskPath = join(tmpdir(), `omni-remwm-mask-${randomUUID()}.png`);
    const detection = await detectRemwmMask({
      image_path: preparedSource.path,
      save_mask_path: saveMaskPath,
      task_prompt: asString(body.task_prompt) || "<REGION_TO_SEGMENTATION>",
      text_input: asString(body.text_input) || "watermark",
      max_new_tokens:
        typeof body.max_new_tokens === "number" ? body.max_new_tokens : 1024,
      num_beams: typeof body.num_beams === "number" ? body.num_beams : 3,
    });
    const maskPath = asString(detection.mask_path);
    return successResult({
      ...detection,
      engine: "remwm",
      mask_data_url: maskPath ? bufferToDataUrl(readFileSync(maskPath), "image/png") : null,
    });
  }

  if (path === "remwm/detect-mask-batch") {
    const rawSources = Array.isArray(body.images)
      ? body.images
      : Array.isArray(body.image_paths)
        ? body.image_paths
        : [];
    const prepared = await Promise.all(
      rawSources
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => prepareImageInput(item)),
    );
    const outputDir = join(tmpdir(), `omni-remwm-batch-${randomUUID()}`);
    const detection = await detectRemwmMaskBatch({
      image_paths: prepared.map((item) => item.path),
      output_dir: outputDir,
      task_prompt: asString(body.task_prompt) || "<REGION_TO_SEGMENTATION>",
      text_input: asString(body.text_input) || "watermark",
      max_new_tokens:
        typeof body.max_new_tokens === "number" ? body.max_new_tokens : 1024,
      num_beams: typeof body.num_beams === "number" ? body.num_beams : 3,
    });
    return successResult({
      items: detection.items,
    });
  }

  return forwardUpstream(req, path);
};

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  return withAuthorizedRoute(req, "/api/iopaint/[...path]", () => runGet(req, context));
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  return withAuthorizedRoute(req, "/api/iopaint/[...path]", () => runPost(req, context));
}
