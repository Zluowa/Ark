"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2Icon,
  DownloadIcon,
  EraserIcon,
  ImagePlusIcon,
  Loader2Icon,
  MousePointer2Icon,
  PaintbrushVerticalIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  Undo2Icon,
  WandSparklesIcon,
} from "lucide-react";
import type { ToolManifest } from "@/lib/engine/types";
import { cn } from "@/lib/utils";
import { executeToolSync, uploadToolInputFiles } from "@/lib/api/tooling";
import {
  detectRemwmMask,
  getIOPaintCurrentModel,
  getIOPaintServerConfig,
  runIOPaintAdjustMask,
  runIOPaintInpaint,
  runIOPaintPluginImage,
  runIOPaintPluginMask,
  switchIOPaintModel,
  switchIOPaintPluginModel,
  type StudioImageResult,
} from "@/lib/api/iopaint";

type EditorMode = "brush" | "erase" | "segment-positive" | "segment-negative";
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

type ModelInfo = {
  name: string;
  model_type?: string;
};

type ServerConfig = {
  modelInfos?: ModelInfo[];
  removeBGModels?: string[];
  removeBGModel?: string;
  realesrganModels?: string[];
  realesrganModel?: string;
  interactiveSegModels?: string[];
  interactiveSegModel?: string;
  samplers?: string[];
  controlnetMethod?: string | null;
};

type AdvancedSettings = {
  prompt: string;
  negativePrompt: string;
  hdStrategy: string;
  sdStrength: number;
  sdSteps: number;
  sdGuidanceScale: number;
  sdSampler: string;
  sdSeed: number;
  sdMaskBlur: number;
  sdKeepUnmaskedArea: boolean;
  sdMatchHistograms: boolean;
  enableControlnet: boolean;
  controlnetMethod: string;
  enableBrushnet: boolean;
  brushnetMethod: string;
  enablePowerpaintV2: boolean;
  powerpaintTask: string;
  scale: number;
  outpaintTop: number;
  outpaintRight: number;
  outpaintBottom: number;
  outpaintLeft: number;
  rawPayload: string;
};

type SessionSnapshot = {
  id: string;
  label: string;
  detail: string;
  url: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
};

type BatchWatermarkItemState = {
  id: string;
  name: string;
  status: "queued" | "uploading" | "running" | "done" | "error";
  message?: string;
};

type BatchWatermarkResult = {
  outputUrl: string;
  filename: string;
  detail: string;
  processedCount: number;
  failedCount: number;
  items: Array<Record<string, unknown>>;
};

const DEFAULT_SETTINGS: AdvancedSettings = {
  prompt: "",
  negativePrompt: "",
  hdStrategy: "Crop",
  sdStrength: 1,
  sdSteps: 50,
  sdGuidanceScale: 7.5,
  sdSampler: "uni_pc",
  sdSeed: -1,
  sdMaskBlur: 8,
  sdKeepUnmaskedArea: true,
  sdMatchHistograms: false,
  enableControlnet: false,
  controlnetMethod: "lllyasviel/control_v11p_sd15_canny",
  enableBrushnet: false,
  brushnetMethod: "random_mask",
  enablePowerpaintV2: false,
  powerpaintTask: "text-guided",
  scale: 2,
  outpaintTop: 0,
  outpaintRight: 160,
  outpaintBottom: 0,
  outpaintLeft: 160,
  rawPayload: "",
};

const STUDIO_PRESET_META: Record<
  StudioPreset,
  { label: string; hint: string; accent: string }
> = {
  manual: {
    label: "Manual",
    hint: "Mask, segment, retouch, and outpaint with full payload control.",
    accent: "border-white/12 bg-white/[0.04] text-white/74",
  },
  watermark: {
    label: "Watermark",
    hint: "Prepare a cleanup mask first, then refine the repair before exporting.",
    accent: "border-sky-300/30 bg-sky-300/12 text-sky-100",
  },
  "remove-object": {
    label: "Remove",
    hint: "Mask the subject you want gone, then rebuild the scene with a cleanup prompt.",
    accent: "border-rose-300/22 bg-rose-300/10 text-rose-100",
  },
  "replace-object": {
    label: "Replace",
    hint: "Mask the target, describe the new object, and optionally load a reference image.",
    accent: "border-cyan-300/22 bg-cyan-300/10 text-cyan-100",
  },
  "add-text": {
    label: "Text",
    hint: "Mask the placement, type the exact words, and guide the styling before rendering.",
    accent: "border-violet-300/22 bg-violet-300/10 text-violet-100",
  },
  "remove-background": {
    label: "Cutout",
    hint: "Switch RemoveBG models, isolate the subject, and fine-tune edges manually.",
    accent: "border-emerald-300/24 bg-emerald-300/10 text-emerald-100",
  },
  "face-restore": {
    label: "Portrait",
    hint: "Use GFPGAN or RestoreFormer, then retouch specific regions with mask edits.",
    accent: "border-amber-300/24 bg-amber-300/10 text-amber-100",
  },
  upscale: {
    label: "Upscale",
    hint: "Pick the RealESRGAN model, preview the result, then continue manual cleanup.",
    accent: "border-fuchsia-300/24 bg-fuchsia-300/10 text-fuchsia-100",
  },
  outpaint: {
    label: "Outpaint",
    hint: "Extend the canvas, inspect the new edges, and guide the fill with prompts.",
    accent: "border-indigo-300/24 bg-indigo-300/10 text-indigo-100",
  },
};

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

const normalizePreset = (value: string | null | undefined): StudioPreset =>
  STUDIO_PRESETS.includes((value || "") as StudioPreset)
    ? ((value || "") as StudioPreset)
    : "manual";

const PRESET_COMPOSER_META: Record<
  StudioPreset,
  {
    label: string;
    placeholder: string;
    helper: string;
    action: string;
  }
> = {
  manual: {
    label: "Prompt composer",
    placeholder: "Describe the edit you want after masking the region...",
    helper: "Use this for freeform retouching, cleanup, replacement, or localized generation.",
    action: "Apply edit",
  },
  watermark: {
    label: "Cleanup prompt",
    placeholder: "Optional cleanup note, for example: preserve the background texture and logo spacing",
    helper: "Watermark mode can work with a blank prompt, but a short cleanup note usually improves the repair.",
    action: "Clean watermark",
  },
  "remove-object": {
    label: "Removal prompt",
    placeholder: "Optional: remove the masked object and reconstruct the background naturally",
    helper: "Leave it simple for pure cleanup, or mention what should remain after the object is gone.",
    action: "Remove object",
  },
  "replace-object": {
    label: "Replacement prompt",
    placeholder: "Describe the replacement, for example: a glass orb with soft reflections",
    helper: "Mask the old object first. A reference image makes swaps much more stable.",
    action: "Replace object",
  },
  "add-text": {
    label: "Text prompt",
    placeholder: "Describe the typography treatment, for example: cinematic poster lettering with subtle glow",
    helper: "Type the exact words, then refine the visual treatment with this prompt.",
    action: "Render text",
  },
  "remove-background": {
    label: "Cutout workflow",
    placeholder: "Optional cutout note",
    helper: "Run RemoveBG first, then use mask tools to repair edges or restore missing detail.",
    action: "Remove background",
  },
  "face-restore": {
    label: "Portrait workflow",
    placeholder: "Optional restoration note",
    helper: "Use a restoration engine first, then retouch specific regions with masking if needed.",
    action: "Restore portrait",
  },
  upscale: {
    label: "Upscale workflow",
    placeholder: "Optional upscale note",
    helper: "RealESRGAN handles scale first. After that, continue with local cleanup if the result needs polish.",
    action: "Upscale image",
  },
  outpaint: {
    label: "Outpaint prompt",
    placeholder: "Describe the new area you want beyond the current frame...",
    helper: "Adjust the expansion values, then guide the new content with a concise scene prompt.",
    action: "Outpaint image",
  },
};

const dataUrlFromFile = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

const loadImage = async (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const buildMaskExport = (canvas: HTMLCanvasElement): string => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const context = exportCanvas.getContext("2d");
  if (!context) {
    return "";
  }
  context.fillStyle = "#000";
  context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.drawImage(canvas, 0, 0);
  return exportCanvas.toDataURL("image/png");
};

const maskHasCoverage = (canvas: HTMLCanvasElement | null): boolean => {
  if (!canvas) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) {
      return true;
    }
  }
  return false;
};

const buildOutpaintPayload = async (
  source: string,
  expand: { top: number; right: number; bottom: number; left: number },
): Promise<{ image: string; mask: string }> => {
  const image = await loadImage(source);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const expandedWidth = width + expand.left + expand.right;
  const expandedHeight = height + expand.top + expand.bottom;

  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = expandedWidth;
  imageCanvas.height = expandedHeight;
  const imageContext = imageCanvas.getContext("2d");
  if (!imageContext) {
    throw new Error("Failed to create outpaint canvas");
  }
  imageContext.clearRect(0, 0, expandedWidth, expandedHeight);
  imageContext.drawImage(image, expand.left, expand.top, width, height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = expandedWidth;
  maskCanvas.height = expandedHeight;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) {
    throw new Error("Failed to create outpaint mask");
  }
  maskContext.fillStyle = "#fff";
  maskContext.fillRect(0, 0, expandedWidth, expandedHeight);
  maskContext.clearRect(expand.left, expand.top, width, height);

  return {
    image: imageCanvas.toDataURL("image/png"),
    mask: buildMaskExport(maskCanvas),
  };
};

const parseRawPayload = (value: string): Record<string, unknown> => {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
};

const controlInputClass =
  "w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/40";
const sectionTitleClass = "text-[11px] font-medium uppercase tracking-[0.28em] text-white/42";

function StudioSidebarSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
      <div className={sectionTitleClass}>{title}</div>
      {children}
    </section>
  );
}

export function IOPaintStudio({ tool }: { tool: ToolManifest }) {
  const searchParams = useSearchParams();
  const uploadRef = useRef<HTMLInputElement>(null);
  const referenceUploadRef = useRef<HTMLInputElement>(null);
  const batchUploadRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const surfaceCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const localOriginalPreviewRef = useRef<string | null>(null);

  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [currentModel, setCurrentModel] = useState<string>("lama");
  const [selectedModel, setSelectedModel] = useState<string>("lama");
  const [removeBgModel, setRemoveBgModel] = useState<string>("briaai/RMBG-1.4");
  const [realesrganModel, setRealesrganModel] = useState<string>("realesr-general-x4v3");
  const [interactiveSegModel, setInteractiveSegModel] = useState<string>("sam2_1_tiny");
  const [faceRestoreEngine, setFaceRestoreEngine] = useState<"GFPGAN" | "RestoreFormer">("GFPGAN");
  const [settings, setSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS);
  const [sourceInput, setSourceInput] = useState<string>("");
  const [displayUrl, setDisplayUrl] = useState<string>("");
  const [originalUrl, setOriginalUrl] = useState<string>("");
  const [referenceImage, setReferenceImage] = useState<string>("");
  const [editorMode, setEditorMode] = useState<EditorMode>("brush");
  const [brushSize, setBrushSize] = useState<number>(28);
  const [segClicks, setSegClicks] = useState<number[][]>([]);
  const [maskHistory, setMaskHistory] = useState<string[]>([]);
  const [sessionHistory, setSessionHistory] = useState<SessionSnapshot[]>([]);
  const [statusText, setStatusText] = useState<string>("Load an image to start a full IOPaint session.");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [resultMeta, setResultMeta] = useState<StudioImageResult | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(true);
  const [activePreset, setActivePreset] = useState<StudioPreset>(
    normalizePreset(searchParams.get("preset")),
  );
  const [compareOriginal, setCompareOriginal] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [presetBootstrapped, setPresetBootstrapped] = useState<boolean>(false);
  const [batchItems, setBatchItems] = useState<BatchWatermarkItemState[]>([]);
  const [batchRunning, setBatchRunning] = useState<boolean>(false);
  const [batchResult, setBatchResult] = useState<BatchWatermarkResult | null>(null);
  const [surfaceReady, setSurfaceReady] = useState<boolean>(false);
  const [textInsertContent, setTextInsertContent] = useState<string>("");
  const [textInsertStyle, setTextInsertStyle] = useState<string>("bold white sans-serif");

  const sourceFromQuery = searchParams.get("source")?.trim() || "";
  const presetFromQuery = normalizePreset(searchParams.get("preset"));
  const placementFromQuery = searchParams.get("placement")?.trim() || "auto";
  const autorunFromQuery = searchParams.get("autorun") === "1";
  const removeBgModelFromQuery = searchParams.get("plugin_model")?.trim() || "";
  const promptFromQuery = searchParams.get("prompt")?.trim() || "";
  const textFromQuery = searchParams.get("text")?.trim() || "";
  const styleFromQuery = searchParams.get("style")?.trim() || "";
  const hasSource = Boolean(sourceInput);

  const samplerOptions = useMemo(
    () => (Array.isArray(config?.samplers) ? config?.samplers : ["uni_pc"]),
    [config],
  );

  const syncSurfaceCanvas = useCallback(async (surfaceSource?: string | null) => {
    const canvas = surfaceCanvasRef.current;
    if (!canvas || !surfaceSource) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const currentImage = imageRef.current;
    const image =
      currentImage &&
      currentImage.complete &&
      currentImage.naturalWidth > 0 &&
      (currentImage.currentSrc === surfaceSource || currentImage.src === surfaceSource)
        ? currentImage
        : await loadImage(surfaceSource);
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    setSurfaceReady(true);
  }, []);

  const syncMaskCanvas = useCallback(async (maskSource?: string | null) => {
    const canvas = maskCanvasRef.current;
    const surface = surfaceCanvasRef.current;
    const image = imageRef.current;
    if (!canvas) return;
    const width = surface?.width || image?.naturalWidth || image?.width || 1;
    const height = surface?.height || image?.naturalHeight || image?.height || 1;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!maskSource) return;
    const maskImage = await loadImage(maskSource);
    context.drawImage(maskImage, 0, 0, width, height);
  }, []);

  const pushMaskSnapshot = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const snapshot = canvas.toDataURL("image/png");
    setMaskHistory((current) => [...current.slice(-14), snapshot]);
  }, []);

  const resetMaskState = useCallback(async () => {
    setSegClicks([]);
    setMaskHistory([]);
    await syncMaskCanvas(null);
  }, [syncMaskCanvas]);

  const commitImageResult = useCallback(
    async (result: StudioImageResult, nextStatus?: string) => {
      const nextUrl =
        typeof result.output_file_url === "string" && result.output_file_url.trim()
          ? result.output_file_url
          : typeof result.preview_url === "string"
            ? result.preview_url
            : "";
      if (!nextUrl) {
        throw new Error("Image result did not return a usable output URL");
      }
      setSourceInput(nextUrl);
      setDisplayUrl(nextUrl);
      setSurfaceReady(false);
      setResultMeta(result);
      setCompareOriginal(false);
      setSessionHistory((current) => [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          label: nextStatus || "Image updated",
          detail:
            typeof result.detail_text === "string" && result.detail_text.trim()
              ? result.detail_text
              : typeof result.strategy === "string" && result.strategy.trim()
                ? String(result.strategy)
                : "Studio output",
          url: nextUrl,
          sourceUrl: nextUrl,
          width: typeof result.width === "number" ? result.width : undefined,
          height: typeof result.height === "number" ? result.height : undefined,
        },
        ...current.filter((item) => item.url !== nextUrl).slice(0, 9),
      ]);
      if (nextStatus) {
        setStatusText(nextStatus);
      } else if (typeof result.detail_text === "string" && result.detail_text.trim()) {
        setStatusText(result.detail_text);
      } else {
        setStatusText("Image updated.");
      }
      setSegClicks([]);
      await syncMaskCanvas(null);
    },
    [syncMaskCanvas],
  );

  const runAsyncAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setLoading(true);
      setError("");
      setStatusText(label);
      try {
        await action();
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : String(actionError));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const buildInpaintPayload = useCallback(
    (image: string, mask: string): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        image,
        mask,
        model: selectedModel,
        prompt: settings.prompt,
        negative_prompt: settings.negativePrompt,
        hd_strategy: settings.hdStrategy,
        sd_strength: settings.sdStrength,
        sd_steps: settings.sdSteps,
        sd_guidance_scale: settings.sdGuidanceScale,
        sd_seed: settings.sdSeed,
        sd_mask_blur: settings.sdMaskBlur,
        sd_keep_unmasked_area: settings.sdKeepUnmaskedArea,
        sd_match_histograms: settings.sdMatchHistograms,
        sd_sampler: settings.sdSampler || (samplerOptions.includes("uni_pc") ? "uni_pc" : samplerOptions[0]),
        enable_controlnet: settings.enableControlnet,
        controlnet_method: settings.controlnetMethod,
        enable_brushnet: settings.enableBrushnet,
        brushnet_method: settings.brushnetMethod,
        enable_powerpaint_v2: settings.enablePowerpaintV2,
        powerpaint_task: settings.powerpaintTask,
      };
      if (referenceImage) {
        payload.paint_by_example_example_image = referenceImage;
      }
      return {
        ...payload,
        ...parseRawPayload(settings.rawPayload),
      };
    },
    [referenceImage, samplerOptions, selectedModel, settings],
  );

  const loadSourceImage = useCallback(
    async (nextSource: string, surfaceUrl?: string) => {
      if (!nextSource) return;
      const nextSurfaceUrl = surfaceUrl || nextSource;
      if (localOriginalPreviewRef.current && localOriginalPreviewRef.current !== nextSurfaceUrl) {
        URL.revokeObjectURL(localOriginalPreviewRef.current);
        localOriginalPreviewRef.current = null;
      }
      if (nextSurfaceUrl.startsWith("blob:")) {
        localOriginalPreviewRef.current = nextSurfaceUrl;
      }
      setSourceInput(nextSource);
      setDisplayUrl(nextSurfaceUrl);
      setOriginalUrl(nextSurfaceUrl);
      setSurfaceReady(false);
      setResultMeta(null);
      setCompareOriginal(false);
      setPresetBootstrapped(false);
      setSessionHistory([
        {
          id: `source-${Date.now()}`,
          label: "Source",
          detail: "Original image",
          url: nextSurfaceUrl,
          sourceUrl: nextSource,
        },
      ]);
      setStatusText("Image loaded. Start masking or run a plugin.");
      setError("");
      await syncMaskCanvas(null);
    },
    [syncMaskCanvas],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [serverConfig, activeModel] = await Promise.all([
          getIOPaintServerConfig<ServerConfig>(),
          getIOPaintCurrentModel<ModelInfo>(),
        ]);
        setConfig(serverConfig);
        setCurrentModel(activeModel.name);
        setSelectedModel(activeModel.name);
        if (serverConfig.removeBGModel) setRemoveBgModel(serverConfig.removeBGModel);
        if (serverConfig.realesrganModel) setRealesrganModel(serverConfig.realesrganModel);
        if (serverConfig.interactiveSegModel) setInteractiveSegModel(serverConfig.interactiveSegModel);
        setSettings((current) => ({
          ...current,
          controlnetMethod: serverConfig.controlnetMethod || current.controlnetMethod,
          sdSampler:
            Array.isArray(serverConfig.samplers) && serverConfig.samplers.length > 0
              ? serverConfig.samplers[0]
              : current.sdSampler,
        }));
      } catch (configError) {
        setError(configError instanceof Error ? configError.message : String(configError));
      }
    })();
  }, []);

  useEffect(() => {
    if (!sourceFromQuery) return;
    void loadSourceImage(sourceFromQuery);
  }, [loadSourceImage, sourceFromQuery]);

  useEffect(() => {
    setActivePreset(presetFromQuery);
  }, [presetFromQuery]);

  useEffect(() => {
    if (promptFromQuery) {
      setSettings((current) => (current.prompt === promptFromQuery ? current : { ...current, prompt: promptFromQuery }));
    }
  }, [promptFromQuery]);

  useEffect(() => {
    if (textFromQuery) {
      setTextInsertContent(textFromQuery);
    }
  }, [textFromQuery]);

  useEffect(() => {
    if (styleFromQuery) {
      setTextInsertStyle(styleFromQuery);
    }
  }, [styleFromQuery]);

  useEffect(() => {
    if (!removeBgModelFromQuery) return;
    setRemoveBgModel((current) =>
      current === removeBgModelFromQuery ? current : removeBgModelFromQuery,
    );
  }, [removeBgModelFromQuery]);

  useEffect(() => {
    if (!hasSource) return;
    setStatusText(STUDIO_PRESET_META[activePreset].hint);
  }, [activePreset, hasSource]);

  const onUpload = useCallback(async (file?: File | null) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setStatusText("Uploading image into the Studio session...");
    try {
      const uploaded = await uploadToolInputFiles([file], "image.iopaint_studio");
      const processingUrl = uploaded[0]?.executor_url || uploaded[0]?.url;
      const displayUrl = uploaded[0]?.url || uploaded[0]?.executor_url;
      if (processingUrl) {
        await loadSourceImage(processingUrl, displayUrl || processingUrl);
        return;
      }
      const dataUrl = await dataUrlFromFile(file);
      const previewUrl = URL.createObjectURL(file);
      await loadSourceImage(dataUrl, previewUrl);
    } catch (uploadError) {
      const dataUrl = await dataUrlFromFile(file);
      const previewUrl = URL.createObjectURL(file);
      await loadSourceImage(dataUrl, previewUrl);
      setStatusText(
        `Image loaded locally. Upload fallback used: ${
          uploadError instanceof Error ? uploadError.message : String(uploadError)
        }`,
      );
    } finally {
      setLoading(false);
    }
  }, [loadSourceImage]);

  const onReferenceUpload = useCallback(async (file?: File | null) => {
    if (!file) return;
    const dataUrl = await dataUrlFromFile(file);
    setReferenceImage(dataUrl);
  }, []);

  const drawStroke = useCallback((x: number, y: number) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    if (editorMode === "erase") {
      context.globalCompositeOperation = "destination-out";
      context.strokeStyle = "rgba(0,0,0,1)";
      context.fillStyle = "rgba(0,0,0,1)";
    } else {
      context.globalCompositeOperation = "source-over";
      context.strokeStyle = "rgba(255,255,255,1)";
      context.fillStyle = "rgba(255,255,255,1)";
    }
    context.lineTo(x, y);
    context.stroke();
  }, [brushSize, editorMode]);

  const onMaskPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    if (editorMode === "segment-positive" || editorMode === "segment-negative") {
      const label = editorMode === "segment-positive" ? 1 : 0;
      const nextClicks = [...segClicks, [Math.round(x), Math.round(y), label]];
      setSegClicks(nextClicks);
      void runAsyncAction("Generating segmentation mask...", async () => {
        const result = await runIOPaintPluginMask({
          name: "InteractiveSeg",
          image: sourceInput,
          plugin_model: interactiveSegModel,
          clicks: nextClicks,
        });
        await syncMaskCanvas(result.preview_url || result.output_file_url || result.mask_data_url || null);
        setStatusText(`Interactive segmentation updated with ${nextClicks.length} click(s).`);
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(x, y);
    drawStroke(x, y);
  }, [drawStroke, editorMode, interactiveSegModel, runAsyncAction, segClicks, sourceInput, syncMaskCanvas]);

  const onMaskPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!(event.buttons & 1)) return;
    if (editorMode === "segment-positive" || editorMode === "segment-negative") return;
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    drawStroke(x, y);
  }, [drawStroke, editorMode]);

  const onMaskPointerUp = useCallback(() => {
    if (editorMode === "segment-positive" || editorMode === "segment-negative") return;
    pushMaskSnapshot();
  }, [editorMode, pushMaskSnapshot]);

  const exportMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    return canvas ? buildMaskExport(canvas) : "";
  }, []);

  const hasMask = useMemo(() => Boolean(maskHistory.length || segClicks.length), [maskHistory.length, segClicks.length]);

  const executeInpaint = useCallback(async (promptOverride?: string) => {
    if (!sourceInput) throw new Error("Load an image first");
    const mask = exportMask();
    if (!mask) throw new Error("Draw or generate a mask first");
    const payload = buildInpaintPayload(sourceInput, mask);
    if (promptOverride) {
      payload.prompt = promptOverride;
    }
    const result = await runIOPaintInpaint(payload);
    await commitImageResult(result, "Inpaint complete.");
  }, [buildInpaintPayload, commitImageResult, exportMask, sourceInput]);

  const executeMaskAdjust = useCallback(async (operate: "expand" | "shrink" | "reverse") => {
    const mask = exportMask();
    if (!mask) throw new Error("No mask available");
    const result = await runIOPaintAdjustMask({
      mask,
      operate,
      kernel_size: brushSize,
    });
    await syncMaskCanvas(result.mask_data_url || null);
    setStatusText(`Mask ${operate} applied.`);
  }, [brushSize, exportMask, syncMaskCanvas]);

  const executeWatermarkDetect = useCallback(async (placementOverride?: string) => {
    if (!sourceInput) throw new Error("Load an image first");
    const result = await detectRemwmMask({
      image: sourceInput,
      text_input: "watermark",
      placement: placementOverride || placementFromQuery,
    });
    if (!result.mask_data_url) {
      throw new Error("rem-wm did not return a watermark mask");
    }
    await syncMaskCanvas(result.mask_data_url);
    setStatusText(
      typeof result.coverage === "number"
        ? `Watermark mask ready | ${(result.coverage * 100).toFixed(1)}% coverage | ${String(result.engine || "detector")}`
        : "Watermark mask ready.",
    );
  }, [placementFromQuery, sourceInput, syncMaskCanvas]);

  const executePluginImage = useCallback(async (
    pluginName: string,
    options?: {
      pluginModelOverride?: string;
      fallbackStatus?: string;
    },
  ) => {
    if (!sourceInput) throw new Error("Load an image first");
    if (pluginName === "RemoveBG") {
      const pluginModel = options?.pluginModelOverride || removeBgModel;
      const result = await runIOPaintPluginImage({
        name: pluginName,
        image: sourceInput,
        plugin_model: pluginModel,
      });
      await commitImageResult(result, options?.fallbackStatus || "Background removed.");
      return;
    }
    if (pluginName === "RealESRGAN") {
      const result = await runIOPaintPluginImage({
        name: pluginName,
        image: sourceInput,
        plugin_model: realesrganModel,
        scale: settings.scale,
      });
      await commitImageResult(
        result,
        options?.fallbackStatus || `Upscale complete | ${settings.scale}x`,
      );
      return;
    }
    const result = await runIOPaintPluginImage({
      name: pluginName,
      image: sourceInput,
    });
    await commitImageResult(result, options?.fallbackStatus || `${pluginName} complete.`);
  }, [commitImageResult, realesrganModel, removeBgModel, settings.scale, sourceInput]);

  useEffect(() => {
    if (!sourceInput || presetBootstrapped || !autorunFromQuery) return;
    if (presetFromQuery === "watermark") {
      setPresetBootstrapped(true);
      void runAsyncAction("Preparing watermark mask...", async () => {
        await executeWatermarkDetect(placementFromQuery);
        setStatusText("Watermark mask ready. Adjust the region and run inpaint.");
      });
      return;
    }
    if (presetFromQuery === "remove-background") {
      setPresetBootstrapped(true);
      void runAsyncAction("Removing background...", async () => {
        await executePluginImage("RemoveBG", {
          pluginModelOverride: removeBgModelFromQuery || removeBgModel,
          fallbackStatus: "Cutout ready. Compare source or rerun with another model if needed.",
        });
      });
    }
  }, [
    autorunFromQuery,
    executePluginImage,
    executeWatermarkDetect,
    placementFromQuery,
    presetBootstrapped,
    presetFromQuery,
    removeBgModel,
    removeBgModelFromQuery,
    runAsyncAction,
    sourceInput,
  ]);

  const commitToolImageResult = useCallback(async (
    response: Awaited<ReturnType<typeof executeToolSync>>,
    fallbackStatus: string,
  ) => {
    if (response.status !== "success") {
      throw new Error(response.error.message);
    }
    const payload = response.result ?? {};
    const nextUrl =
      typeof payload.output_file_url === "string" && payload.output_file_url.trim()
        ? payload.output_file_url.trim()
        : typeof payload.preview_url === "string" && payload.preview_url.trim()
          ? payload.preview_url.trim()
          : "";
    if (!nextUrl) {
      throw new Error("Tool did not return an image URL");
    }

    await commitImageResult(
      {
        ...(payload as StudioImageResult),
        output_file_url: nextUrl,
        preview_url:
          typeof payload.preview_url === "string" && payload.preview_url.trim()
            ? payload.preview_url.trim()
            : nextUrl,
      },
      typeof payload.detail_text === "string" && payload.detail_text.trim()
        ? payload.detail_text
        : fallbackStatus,
    );
  }, [commitImageResult]);

  const exportMaskForTool = useCallback((): string => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !maskHasCoverage(canvas)) {
      throw new Error("Paint or segment a mask region first.");
    }
    return buildMaskExport(canvas);
  }, []);

  const runToolImageAction = useCallback(async (
    toolId: string,
    params: Record<string, unknown>,
    fallbackStatus: string,
  ) => {
    const response = await executeToolSync(toolId, params);
    await commitToolImageResult(response, fallbackStatus);
  }, [commitToolImageResult]);

  const executeOutpaint = useCallback(async (promptOverride?: string) => {
    if (!sourceInput) throw new Error("Load an image first");
    const expanded = await buildOutpaintPayload(sourceInput, {
      top: clamp(settings.outpaintTop, 0, 2048),
      right: clamp(settings.outpaintRight, 0, 2048),
      bottom: clamp(settings.outpaintBottom, 0, 2048),
      left: clamp(settings.outpaintLeft, 0, 2048),
    });
    const payload = buildInpaintPayload(expanded.image, expanded.mask);
    if (promptOverride) {
      payload.prompt = promptOverride;
    }
    const result = await runIOPaintInpaint(payload);
    await commitImageResult(result, "Outpaint complete.");
  }, [buildInpaintPayload, commitImageResult, settings.outpaintBottom, settings.outpaintLeft, settings.outpaintRight, settings.outpaintTop, sourceInput]);

  const buildPresetPrompt = useCallback((): string => {
    const prompt = settings.prompt.trim();
    if (activePreset === "remove-object") {
      return (
        prompt ||
        "Remove the masked object and reconstruct the background naturally. Preserve perspective, lighting, and nearby texture."
      );
    }
    if (activePreset === "replace-object") {
      if (prompt) {
        return referenceImage
          ? `${prompt}. Use the reference image to guide the replacement and preserve scene lighting.`
          : prompt;
      }
      if (referenceImage) {
        return "Replace the masked region using the reference image. Preserve the original perspective, scale, and lighting.";
      }
      throw new Error("Describe the replacement or load a reference image first.");
    }
    if (activePreset === "add-text") {
      const text = textInsertContent.trim();
      if (!text) {
        throw new Error("Type the exact text you want to render first.");
      }
      const style = textInsertStyle.trim() || "clean editorial typography";
      return prompt
        ? `Render the exact text "${text}" in the masked region. ${prompt}`
        : `Render the exact text "${text}" in the masked region with ${style}. Preserve the surrounding artwork and alignment.`;
    }
    if (activePreset === "outpaint") {
      return (
        prompt ||
        "Extend the scene naturally beyond the current frame while preserving the existing composition, lighting, and color palette."
      );
    }
    if (activePreset === "watermark") {
      return (
        prompt ||
        "Remove the watermark cleanly. Preserve the original subject, composition, color, and texture. Do not add new text or objects."
      );
    }
    return prompt;
  }, [activePreset, referenceImage, settings.prompt, textInsertContent, textInsertStyle]);

  const executePresetAction = useCallback(async () => {
    if (activePreset === "remove-background") {
      await executePluginImage("RemoveBG");
      return;
    }
    if (activePreset === "face-restore") {
      await executePluginImage(faceRestoreEngine);
      return;
    }
    if (activePreset === "upscale") {
      await executePluginImage("RealESRGAN");
      return;
    }
    if (activePreset === "outpaint") {
      const presetPrompt = buildPresetPrompt();
      setSettings((current) => ({ ...current, prompt: presetPrompt }));
      await runToolImageAction(
        "image.outpaint",
        {
          file_url: sourceInput,
          top: clamp(settings.outpaintTop, 0, 2048),
          right: clamp(settings.outpaintRight, 0, 2048),
          bottom: clamp(settings.outpaintBottom, 0, 2048),
          left: clamp(settings.outpaintLeft, 0, 2048),
          prompt: presetPrompt,
        },
        "Outpaint complete.",
      );
      return;
    }
    if (activePreset === "remove-object") {
      const nextPrompt = buildPresetPrompt();
      setSettings((current) => ({ ...current, prompt: nextPrompt }));
      await runToolImageAction(
        "image.remove_object",
        {
          file_url: sourceInput,
          mask_url: exportMaskForTool(),
          prompt: nextPrompt,
        },
        "Object removed.",
      );
      return;
    }
    if (activePreset === "replace-object") {
      const nextPrompt = buildPresetPrompt();
      setSettings((current) => ({ ...current, prompt: nextPrompt }));
      await runToolImageAction(
        "image.replace_object",
        {
          file_url: sourceInput,
          mask_url: exportMaskForTool(),
          prompt: nextPrompt,
          reference_image_url: referenceImage || undefined,
        },
        "Object replaced.",
      );
      return;
    }
    if (activePreset === "add-text") {
      const nextPrompt = buildPresetPrompt();
      const textValue = textInsertContent.trim();
      const styleValue = textInsertStyle.trim();
      setSettings((current) => ({ ...current, prompt: nextPrompt }));
      await runToolImageAction(
        "image.add_text",
        {
          file_url: sourceInput,
          mask_url: exportMaskForTool(),
          text: textValue,
          style: styleValue,
          prompt: nextPrompt,
        },
        "Text inserted.",
      );
      return;
    }
    const nextPrompt = buildPresetPrompt();
    setSettings((current) => ({ ...current, prompt: nextPrompt }));
    await executeInpaint(nextPrompt);
  }, [
    activePreset,
    buildPresetPrompt,
    executeInpaint,
    executePluginImage,
    exportMaskForTool,
    faceRestoreEngine,
    referenceImage,
    runToolImageAction,
    settings.outpaintBottom,
    settings.outpaintLeft,
    settings.outpaintRight,
    settings.outpaintTop,
    sourceInput,
    textInsertContent,
    textInsertStyle,
  ]);

  const undoMask = useCallback(async () => {
    const history = [...maskHistory];
    const previous = history.pop();
    setMaskHistory(history);
    await syncMaskCanvas(previous || null);
  }, [maskHistory, syncMaskCanvas]);

  const downloadCurrent = useCallback(() => {
    if (!displayUrl) return;
    const anchor = document.createElement("a");
    anchor.href = displayUrl;
    anchor.download = String(resultMeta?.filename || "iopaint-result.png");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [displayUrl, resultMeta?.filename]);

  const restoreFromSnapshot = useCallback(async (snapshot: SessionSnapshot) => {
    setDisplayUrl(snapshot.url);
    setSourceInput(snapshot.sourceUrl || snapshot.url);
    setSurfaceReady(false);
    setResultMeta((current) => ({
      ...(current || {}),
      output_file_url: snapshot.url,
      preview_url: snapshot.url,
      filename: current?.filename,
      width: snapshot.width,
      height: snapshot.height,
      detail_text: snapshot.detail,
    }));
    setStatusText(`${snapshot.label} restored.`);
    setCompareOriginal(false);
    await syncMaskCanvas(null);
  }, [syncMaskCanvas]);

  useEffect(() => {
    return () => {
      if (localOriginalPreviewRef.current) {
        URL.revokeObjectURL(localOriginalPreviewRef.current);
        localOriginalPreviewRef.current = null;
      }
    };
  }, []);

  const handleWorkspaceDrop = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setDragActive(false);
    await onUpload(file);
  }, [onUpload]);

  const handleBatchFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBatchRunning(true);
    setBatchResult(null);
    const queue = files.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      status: "queued" as const,
      message: "Waiting to upload",
    }));
    setBatchItems(queue);
    try {
      setBatchItems((current) =>
        current.map((item) => ({ ...item, status: "uploading", message: "Uploading" })),
      );
      const uploaded = await uploadToolInputFiles(files, "image.remove_watermark_batch");
      const urls = uploaded
        .map((item) => item.executor_url ?? item.url)
        .filter((value): value is string => Boolean(value));
      if (!urls.length) {
        throw new Error("Upload did not return any executable image URLs.");
      }
      setBatchItems((current) =>
        current.map((item) => ({ ...item, status: "running", message: "Removing watermark" })),
      );
      const result = await executeToolSync("image.remove_watermark_batch", {
        file_urls: urls,
      });
      if (result.status !== "success") {
        throw new Error(result.error.message || "Batch watermark cleanup failed");
      }
      const output = result.result ?? {};
      const outputUrl =
        typeof output.output_file_url === "string" && output.output_file_url.trim()
          ? output.output_file_url
          : "";
      setBatchResult({
        outputUrl,
        filename:
          typeof output.filename === "string" && output.filename.trim()
            ? output.filename
            : "watermark-free-batch.zip",
        detail:
          typeof output.detail_text === "string" && output.detail_text.trim()
            ? output.detail_text
            : "Batch watermark cleanup complete.",
        processedCount:
          typeof output.processed_count === "number" ? output.processed_count : files.length,
        failedCount: typeof output.failed_count === "number" ? output.failed_count : 0,
        items: Array.isArray(output.items)
          ? (output.items as Array<Record<string, unknown>>)
          : [],
      });
      setBatchItems((current) =>
        current.map((item, index) => ({
          ...item,
          status: index < files.length ? "done" : item.status,
          message: "Ready",
        })),
      );
    } catch (batchError) {
      const message =
        batchError instanceof Error ? batchError.message : String(batchError);
      setBatchItems((current) =>
        current.map((item) => ({ ...item, status: "error", message })),
      );
    } finally {
      setBatchRunning(false);
    }
  }, []);

  const downloadBatchArchive = useCallback(() => {
    if (!batchResult?.outputUrl) return;
    const anchor = document.createElement("a");
    anchor.href = batchResult.outputUrl;
    anchor.download = batchResult.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [batchResult]);

  const displaySurfaceUrl = compareOriginal && originalUrl ? originalUrl : displayUrl;

  useEffect(() => {
    if (!displaySurfaceUrl) return;
    void syncSurfaceCanvas(displaySurfaceUrl);
  }, [displaySurfaceUrl, syncSurfaceCanvas]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(120,197,249,0.13),transparent_22%),linear-gradient(180deg,rgba(4,7,10,1),rgba(7,11,16,1))] text-white"
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        void handleWorkspaceDrop(event.dataTransfer.files);
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1480px] flex-1 gap-5 px-5 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-[30px] border border-white/8 bg-white/[0.04] p-4 shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.34em] text-white/42">{tool.name}</div>
                <div className="mt-1 text-2xl font-medium tracking-[-0.03em]">
                  Full IOPaint Workflow
                </div>
                <div className="mt-2 max-w-3xl text-sm text-white/56">
                  {STUDIO_PRESET_META[activePreset].hint}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => uploadRef.current?.click()}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/78 transition hover:border-white/20 hover:text-white"
                >
                  <span className="inline-flex items-center gap-2">
                    <ImagePlusIcon className="size-4" />
                    Load Image
                  </span>
                </button>
                <button
                  onClick={downloadCurrent}
                  disabled={!displayUrl}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/78 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="inline-flex items-center gap-2">
                    <DownloadIcon className="size-4" />
                    Download
                  </span>
                </button>
                <button
                  onClick={() => referenceUploadRef.current?.click()}
                  className="rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-sm text-sky-100 transition hover:border-sky-300/40 hover:bg-sky-400/15"
                >
                  {activePreset === "replace-object" ? "Load Reference" : "Paint-by-Example"}
                </button>
                <button
                  onClick={() => setCompareOriginal((value) => !value)}
                  disabled={!originalUrl || !displayUrl || originalUrl === displayUrl}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/78 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {compareOriginal ? "Show Current" : "Compare Source"}
                </button>
                <button
                  onClick={() => batchUploadRef.current?.click()}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/78 transition hover:border-white/20 hover:text-white"
                >
                  Batch Watermark
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {STUDIO_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setActivePreset(preset)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    activePreset === preset
                      ? STUDIO_PRESET_META[preset].accent
                      : "border-white/10 bg-white/[0.03] text-white/56 hover:border-white/20 hover:text-white",
                  )}
                >
                  {STUDIO_PRESET_META[preset].label}
                </button>
              ))}
              {referenceImage ? (
                <span className="rounded-full border border-sky-300/18 bg-sky-300/10 px-3 py-1.5 text-xs text-sky-100">
                  Reference loaded
                </span>
              ) : null}
              {originalUrl ? (
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/54">
                  {compareOriginal ? "Viewing source" : "Viewing current result"}
                </span>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { id: "brush", label: "Brush", icon: PaintbrushVerticalIcon },
                { id: "erase", label: "Erase", icon: EraserIcon },
                { id: "segment-positive", label: "Seg +", icon: MousePointer2Icon },
                { id: "segment-negative", label: "Seg -", icon: MousePointer2Icon },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setEditorMode(item.id as EditorMode)}
                  className={cn(
                    "rounded-full border px-3 py-2 text-sm transition",
                    editorMode === item.id
                      ? "border-sky-300/45 bg-sky-300/14 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/58 hover:border-white/20 hover:text-white",
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <item.icon className="size-4" />
                    {item.label}
                  </span>
                </button>
              ))}
              <button
                onClick={() => void runAsyncAction("Detecting watermark...", () => executeWatermarkDetect())}
                disabled={!sourceInput || loading}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm transition disabled:opacity-40",
                  activePreset === "watermark"
                    ? "border-sky-300/30 bg-sky-300/10 text-sky-100 hover:border-sky-300/45"
                    : "border-white/10 bg-white/[0.03] text-white/68 hover:border-white/20 hover:text-white",
                )}
              >
                Auto Watermark Mask
              </button>
              <button
                onClick={() => void runAsyncAction("Removing background...", () => executePluginImage("RemoveBG"))}
                disabled={!sourceInput || loading}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm transition disabled:opacity-40",
                  activePreset === "remove-background"
                    ? "border-emerald-300/24 bg-emerald-300/10 text-emerald-100 hover:border-emerald-300/36"
                    : "border-white/10 bg-white/[0.03] text-white/68 hover:border-white/20 hover:text-white",
                )}
              >
                Remove BG
              </button>
              <button
                onClick={() => void runAsyncAction("Upscaling image...", () => executePluginImage("RealESRGAN"))}
                disabled={!sourceInput || loading}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm transition disabled:opacity-40",
                  activePreset === "upscale"
                    ? "border-fuchsia-300/24 bg-fuchsia-300/10 text-fuchsia-100 hover:border-fuchsia-300/36"
                    : "border-white/10 bg-white/[0.03] text-white/68 hover:border-white/20 hover:text-white",
                )}
              >
                Upscale
              </button>
              <button
                onClick={() => void runAsyncAction("Restoring portrait...", () => executePluginImage(faceRestoreEngine))}
                disabled={!sourceInput || loading}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm transition disabled:opacity-40",
                  activePreset === "face-restore"
                    ? "border-amber-300/24 bg-amber-300/10 text-amber-100 hover:border-amber-300/36"
                    : "border-white/10 bg-white/[0.03] text-white/68 hover:border-white/20 hover:text-white",
                )}
              >
                Face Restore
              </button>
              <button
                onClick={() => void runAsyncAction("Applying inpaint...", executeInpaint)}
                disabled={!sourceInput || loading}
                className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-sm text-sky-100 transition hover:border-sky-300/40 hover:bg-sky-400/15 disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-2">
                  <SparklesIcon className="size-4" />
                  Inpaint
                </span>
              </button>
              <button
                onClick={() => void runAsyncAction("Expanding canvas...", executeOutpaint)}
                disabled={!sourceInput || loading}
                className={cn(
                  "rounded-full border px-3 py-2 text-sm transition disabled:opacity-40",
                  activePreset === "outpaint"
                    ? "border-indigo-300/24 bg-indigo-300/10 text-indigo-100 hover:border-indigo-300/36"
                    : "border-white/10 bg-white/[0.03] text-white/68 hover:border-white/20 hover:text-white",
                )}
              >
                Outpaint
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-white/52">
              <span>Brush {brushSize}px</span>
              <input
                type="range"
                min={4}
                max={96}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                className="w-40 accent-sky-300"
              />
              <button
                onClick={() => void undoMask()}
                disabled={!maskHistory.length}
                className="rounded-full border border-white/10 px-3 py-1.5 text-white/62 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Undo2Icon className="size-3.5" />
                  Undo Mask
                </span>
              </button>
              <button
                onClick={() => void runAsyncAction("Expanding mask...", () => executeMaskAdjust("expand"))}
                disabled={!hasMask || loading}
                className="rounded-full border border-white/10 px-3 py-1.5 text-white/62 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                Expand
              </button>
              <button
                onClick={() => void runAsyncAction("Shrinking mask...", () => executeMaskAdjust("shrink"))}
                disabled={!hasMask || loading}
                className="rounded-full border border-white/10 px-3 py-1.5 text-white/62 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                Shrink
              </button>
              <button
                onClick={() => void runAsyncAction("Reversing mask...", () => executeMaskAdjust("reverse"))}
                disabled={!hasMask || loading}
                className="rounded-full border border-white/10 px-3 py-1.5 text-white/62 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                Reverse
              </button>
              <button
                onClick={() => void resetMaskState()}
                disabled={!sourceInput || loading}
                className="rounded-full border border-white/10 px-3 py-1.5 text-white/62 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Trash2Icon className="size-3.5" />
                  Clear Mask
                </span>
              </button>
            </div>
            {hasSource ? (
              <div className="mt-4 rounded-[26px] border border-white/10 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em] text-white/40">
                      {PRESET_COMPOSER_META[activePreset].label}
                    </div>
                    <div className="mt-2 max-w-2xl text-sm text-white/60">
                      {PRESET_COMPOSER_META[activePreset].helper}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      void runAsyncAction(
                        `${PRESET_COMPOSER_META[activePreset].action}...`,
                        executePresetAction,
                      )
                    }
                    disabled={!sourceInput || loading}
                    className="rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-sm text-sky-100 transition hover:border-sky-300/40 hover:bg-sky-400/15 disabled:opacity-40"
                  >
                    {PRESET_COMPOSER_META[activePreset].action}
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  {activePreset === "add-text" ? (
                    <>
                      <input
                        value={textInsertContent}
                        onChange={(event) => setTextInsertContent(event.target.value)}
                        placeholder='Exact text, for example: "OMNIAGENT 2026"'
                        className={controlInputClass}
                      />
                      <input
                        value={textInsertStyle}
                        onChange={(event) => setTextInsertStyle(event.target.value)}
                        placeholder="Text style, for example: bold white sans-serif with subtle glow"
                        className={controlInputClass}
                      />
                    </>
                  ) : null}
                  <textarea
                    value={settings.prompt}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, prompt: event.target.value }))
                    }
                    placeholder={PRESET_COMPOSER_META[activePreset].placeholder}
                    className={cn(controlInputClass, "min-h-[96px] resize-y")}
                  />
                  {activePreset === "replace-object" ? (
                    <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-white/56">
                      {referenceImage
                        ? "Reference image loaded. The replacement prompt will use it as guidance."
                        : "Optional: load a reference image with Paint-by-Example before applying the replacement."}
                    </div>
                  ) : null}
                  {activePreset === "outpaint" ? (
                    <div className="grid grid-cols-2 gap-2 text-xs text-white/56 sm:grid-cols-4">
                      {[
                        { key: "outpaintTop", label: "Top" },
                        { key: "outpaintRight", label: "Right" },
                        { key: "outpaintBottom", label: "Bottom" },
                        { key: "outpaintLeft", label: "Left" },
                      ].map((field) => (
                        <label key={field.key} className="space-y-1">
                          <span>{field.label}</span>
                          <input
                            type="number"
                            min={0}
                            max={2048}
                            value={String(settings[field.key as keyof AdvancedSettings])}
                            onChange={(event) =>
                              setSettings((current) => ({
                                ...current,
                                [field.key]: Number(event.target.value) || 0,
                              }))
                            }
                            className={controlInputClass}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(120,197,249,0.12),transparent_28%),linear-gradient(180deg,rgba(9,12,17,0.96),rgba(6,8,12,0.98))] shadow-[0_36px_120px_rgba(0,0,0,0.42)]">
            <div className="absolute left-5 top-5 z-10 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/70 backdrop-blur-xl">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {statusText}
                </span>
              ) : (
                statusText
              )}
            </div>
            {displayUrl ? (
              <div className="relative flex flex-1 items-center justify-center px-8 py-10">
                <div
                  className={cn(
                    "relative flex max-h-full max-w-full items-center justify-center overflow-hidden transition",
                    dragActive ? "outline outline-1 outline-sky-300/45" : "",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imageRef}
                    src={displaySurfaceUrl}
                    alt="IOPaint studio source"
                    className={cn(
                      "block max-h-[74vh] max-w-[calc(100vw-520px)] object-contain transition-opacity",
                      surfaceReady ? "opacity-0" : "opacity-100",
                    )}
                    onLoad={() => {
                      void syncSurfaceCanvas(displaySurfaceUrl);
                      void syncMaskCanvas(null);
                    }}
                  />
                  <canvas
                    ref={surfaceCanvasRef}
                    className={cn(
                      "pointer-events-none absolute inset-0 h-full w-full transition-opacity",
                      surfaceReady ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <canvas
                    ref={maskCanvasRef}
                    className={cn(
                      "absolute inset-0 h-full w-full touch-none",
                      compareOriginal
                        ? "pointer-events-none opacity-0"
                        : "cursor-crosshair",
                    )}
                    onPointerDown={onMaskPointerDown}
                    onPointerMove={onMaskPointerMove}
                    onPointerUp={onMaskPointerUp}
                  />
                  {compareOriginal && originalUrl ? (
                    <div className="absolute right-4 top-4 rounded-full border border-amber-300/20 bg-amber-300/12 px-3 py-1.5 text-xs text-amber-100">
                      Comparing original
                    </div>
                  ) : null}
                  {dragActive ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-sky-300/8 text-sm text-sky-100">
                      Drop an image to replace the current session
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <button
                onClick={() => uploadRef.current?.click()}
                className="m-6 flex flex-1 flex-col items-center justify-center gap-4 rounded-[28px] border border-dashed border-white/14 bg-white/[0.03] text-white/52 transition hover:border-white/24 hover:text-white"
              >
                <ImagePlusIcon className="size-9" />
                <div className="text-sm">Drop or load an image to enter the editor.</div>
                <div className="text-xs text-white/34">Mask painting, segmentation, plugins, and raw IOPaint params live here.</div>
              </button>
            )}
          </div>

          <div className="rounded-[30px] border border-white/8 bg-white/[0.04] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/42">Session Timeline</div>
                <div className="mt-1 text-sm text-white/58">
                  Jump between the source and the latest outputs without leaving the editor.
                </div>
              </div>
              <div className="text-xs text-white/42">
                {sessionHistory.length} state{sessionHistory.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
              {sessionHistory.map((snapshot) => {
                const active = displayUrl === snapshot.url || (compareOriginal && originalUrl === snapshot.url);
                return (
                  <button
                    key={snapshot.id}
                    onClick={() => void restoreFromSnapshot(snapshot)}
                    className={cn(
                      "min-w-[180px] rounded-[24px] border px-4 py-3 text-left transition",
                      active
                        ? "border-sky-300/32 bg-sky-300/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20",
                    )}
                  >
                    <div className="text-sm font-medium text-white">{snapshot.label}</div>
                    <div className="mt-1 text-xs text-white/52">{snapshot.detail}</div>
                    {(snapshot.width && snapshot.height) ? (
                      <div className="mt-2 text-[11px] text-white/38">
                        {snapshot.width} x {snapshot.height}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="w-[360px] shrink-0 space-y-4 overflow-y-auto pr-1">
          <StudioSidebarSection title="Session">
            <div className="space-y-2 text-sm text-white/70">
              <div className="flex items-center justify-between">
                <span>Current model</span>
                <span className="text-white">{currentModel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Preset</span>
                <span className="text-white">{STUDIO_PRESET_META[activePreset].label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>History</span>
                <span className="text-white">{sessionHistory.length}</span>
              </div>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className={controlInputClass}
              >
                {(config?.modelInfos || []).map((model) => (
                  <option key={model.name} value={model.name} className="bg-zinc-950">
                    {model.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  void runAsyncAction("Switching IOPaint model...", async () => {
                    const next = await switchIOPaintModel<ModelInfo>(selectedModel);
                    setCurrentModel(next.name);
                    setSelectedModel(next.name);
                    setStatusText(`Model switched to ${next.name}.`);
                  })
                }
                disabled={!selectedModel || loading}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/72 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                Switch Model
              </button>
            </div>
          </StudioSidebarSection>

          <StudioSidebarSection title="Batch Watermark">
            <div className="space-y-3 text-sm text-white/72">
              <button
                onClick={() => batchUploadRef.current?.click()}
                disabled={batchRunning}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/72 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                {batchRunning ? "Running batch cleanup..." : "Load image batch"}
              </button>
              <div className="rounded-[20px] border border-white/8 bg-black/20 px-3 py-3 text-xs text-white/54">
                Use this lane for bulk watermark cleanup. Single-image retouch stays in the main canvas.
              </div>
              {batchItems.length ? (
                <div className="space-y-2">
                  {batchItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-2 text-xs"
                    >
                      <div className="truncate text-white/84">{item.name}</div>
                      <div className="mt-1 text-white/46">
                        {item.status === "done" ? "Ready" : item.message || item.status}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {batchResult ? (
                <div className="rounded-[20px] border border-emerald-400/18 bg-emerald-400/8 px-3 py-3 text-xs text-emerald-100/90">
                  <div className="flex items-center gap-2 text-sm text-emerald-100">
                    <CheckCircle2Icon className="size-4" />
                    Batch ready
                  </div>
                  <div className="mt-2">{batchResult.detail}</div>
                  <div className="mt-1 text-emerald-100/70">
                    {batchResult.processedCount} cleaned · {batchResult.failedCount} failed
                  </div>
                  <button
                    onClick={downloadBatchArchive}
                    disabled={!batchResult.outputUrl}
                    className="mt-3 w-full rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-50 transition hover:border-emerald-200/35 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Download ZIP
                  </button>
                </div>
              ) : null}
            </div>
          </StudioSidebarSection>

          <StudioSidebarSection title="Plugins">
            <div className="space-y-3 text-sm text-white/72">
              <div className="space-y-2">
                <div className="text-white/54">RemoveBG model</div>
                <select
                  value={removeBgModel}
                  onChange={(event) => setRemoveBgModel(event.target.value)}
                  className={controlInputClass}
                >
                  {(config?.removeBGModels || [removeBgModel]).map((model) => (
                    <option key={model} value={model} className="bg-zinc-950">
                      {model}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    void runAsyncAction("Switching RemoveBG model...", async () => {
                      await switchIOPaintPluginModel("RemoveBG", removeBgModel);
                      setStatusText(`RemoveBG model switched to ${removeBgModel}.`);
                    })
                  }
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/72 transition hover:border-white/20 hover:text-white"
                >
                  Apply RemoveBG Model
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-white/54">RealESRGAN model</div>
                <select
                  value={realesrganModel}
                  onChange={(event) => setRealesrganModel(event.target.value)}
                  className={controlInputClass}
                >
                  {(config?.realesrganModels || [realesrganModel]).map((model) => (
                    <option key={model} value={model} className="bg-zinc-950">
                      {model}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    void runAsyncAction("Switching RealESRGAN model...", async () => {
                      await switchIOPaintPluginModel("RealESRGAN", realesrganModel);
                      setStatusText(`RealESRGAN model switched to ${realesrganModel}.`);
                    })
                  }
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/72 transition hover:border-white/20 hover:text-white"
                >
                  Apply Upscaler Model
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-white/54">InteractiveSeg model</div>
                <select
                  value={interactiveSegModel}
                  onChange={(event) => setInteractiveSegModel(event.target.value)}
                  className={controlInputClass}
                >
                  {(config?.interactiveSegModels || [interactiveSegModel]).map((model) => (
                    <option key={model} value={model} className="bg-zinc-950">
                      {model}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    void runAsyncAction("Switching InteractiveSeg model...", async () => {
                      await switchIOPaintPluginModel("InteractiveSeg", interactiveSegModel);
                      setStatusText(`InteractiveSeg model switched to ${interactiveSegModel}.`);
                    })
                  }
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/72 transition hover:border-white/20 hover:text-white"
                >
                  Apply Segmentation Model
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-white/54">Face restoration engine</div>
                <select
                  value={faceRestoreEngine}
                  onChange={(event) =>
                    setFaceRestoreEngine(event.target.value === "RestoreFormer" ? "RestoreFormer" : "GFPGAN")
                  }
                  className={controlInputClass}
                >
                  <option value="GFPGAN" className="bg-zinc-950">GFPGAN</option>
                  <option value="RestoreFormer" className="bg-zinc-950">RestoreFormer</option>
                </select>
              </div>
            </div>
          </StudioSidebarSection>

          <StudioSidebarSection title="Advanced">
            <button
              onClick={() => setAdvancedOpen((value) => !value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-sm text-white/72 transition hover:border-white/20 hover:text-white"
            >
              <span className="inline-flex items-center gap-2">
                <WandSparklesIcon className="size-4" />
                {advancedOpen ? "Hide advanced payload" : "Show advanced payload"}
              </span>
            </button>

            {advancedOpen && (
              <div className="space-y-3 text-sm text-white/72">
                <textarea
                  value={settings.prompt}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, prompt: event.target.value }))
                  }
                  placeholder="Prompt"
                  rows={3}
                  className={cn(controlInputClass, "min-h-[88px] resize-none")}
                />
                <textarea
                  value={settings.negativePrompt}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, negativePrompt: event.target.value }))
                  }
                  placeholder="Negative prompt"
                  rows={2}
                  className={cn(controlInputClass, "min-h-[72px] resize-none")}
                />
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-2">
                    <span className="text-white/50">HD strategy</span>
                    <select
                      value={settings.hdStrategy}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, hdStrategy: event.target.value }))
                      }
                      className={controlInputClass}
                    >
                      <option value="Crop" className="bg-zinc-950">Crop</option>
                      <option value="Resize" className="bg-zinc-950">Resize</option>
                      <option value="Original" className="bg-zinc-950">Original</option>
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-white/50">Sampler</span>
                    <select
                      value={settings.sdSampler}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, sdSampler: event.target.value }))
                      }
                      className={controlInputClass}
                    >
                      {samplerOptions.map((sampler) => (
                        <option key={sampler} value={sampler} className="bg-zinc-950">
                          {sampler}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "sdStrength", label: "Strength", min: 0, max: 1, step: 0.05 },
                    { key: "sdGuidanceScale", label: "Guidance", min: 0, max: 20, step: 0.5 },
                    { key: "sdSteps", label: "Steps", min: 1, max: 120, step: 1 },
                    { key: "scale", label: "Upscale", min: 1, max: 4, step: 1 },
                    { key: "sdMaskBlur", label: "Mask blur", min: 0, max: 64, step: 1 },
                    { key: "sdSeed", label: "Seed", min: -1, max: 99999999, step: 1 },
                  ].map((field) => (
                    <label key={field.key} className="space-y-2">
                      <span className="text-white/50">{field.label}</span>
                      <input
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={String(settings[field.key as keyof AdvancedSettings])}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            [field.key]: Number(event.target.value),
                          }))
                        }
                        className={controlInputClass}
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "outpaintTop", label: "Outpaint top" },
                    { key: "outpaintRight", label: "Outpaint right" },
                    { key: "outpaintBottom", label: "Outpaint bottom" },
                    { key: "outpaintLeft", label: "Outpaint left" },
                  ].map((field) => (
                    <label key={field.key} className="space-y-2">
                      <span className="text-white/50">{field.label}</span>
                      <input
                        type="number"
                        min={0}
                        max={2048}
                        step={8}
                        value={String(settings[field.key as keyof AdvancedSettings])}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            [field.key]: Number(event.target.value),
                          }))
                        }
                        className={controlInputClass}
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs text-white/56">
                  {[
                    ["sdKeepUnmaskedArea", "Keep unmasked area"],
                    ["sdMatchHistograms", "Match histograms"],
                    ["enableControlnet", "Enable ControlNet"],
                    ["enableBrushnet", "Enable BrushNet"],
                    ["enablePowerpaintV2", "Enable PowerPaint v2"],
                  ].map(([key, label]) => (
                    <label key={key} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(settings[key as keyof AdvancedSettings])}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            [key]: event.target.checked,
                          }))
                        }
                        className="accent-sky-300"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <input
                  value={settings.controlnetMethod}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, controlnetMethod: event.target.value }))
                  }
                  className={controlInputClass}
                  placeholder="ControlNet method"
                />
                <input
                  value={settings.brushnetMethod}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, brushnetMethod: event.target.value }))
                  }
                  className={controlInputClass}
                  placeholder="BrushNet method"
                />
                <input
                  value={settings.powerpaintTask}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, powerpaintTask: event.target.value }))
                  }
                  className={controlInputClass}
                  placeholder="PowerPaint task"
                />
                <textarea
                  value={settings.rawPayload}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, rawPayload: event.target.value }))
                  }
                  rows={6}
                  placeholder='Raw JSON override, for example {"sd_sampler":"euler_a","use_croper":true}'
                  className={cn(controlInputClass, "min-h-[140px] resize-y font-mono text-xs")}
                />
              </div>
            )}
          </StudioSidebarSection>

          <StudioSidebarSection title="Status">
            <div className="space-y-2 text-sm text-white/68">
              <div>{statusText}</div>
              {error ? <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-red-200">{error}</div> : null}
              {resultMeta ? (
                <div className="rounded-[20px] border border-white/8 bg-black/20 px-3 py-3 text-xs text-white/56">
                  <div className="font-medium text-white/82">{resultMeta.filename || "Result"}</div>
                  <div className="mt-1">
                    {(typeof resultMeta.width === "number" && typeof resultMeta.height === "number")
                      ? `${resultMeta.width} x ${resultMeta.height}`
                      : "Dimensions pending"}
                  </div>
                  <div>{resultMeta.detail_text || resultMeta.strategy || "Image updated"}</div>
                </div>
              ) : null}
              <button
                onClick={() => void runAsyncAction("Reloading service config...", async () => {
                  const [serverConfig, activeModel] = await Promise.all([
                    getIOPaintServerConfig<ServerConfig>(),
                    getIOPaintCurrentModel<ModelInfo>(),
                  ]);
                  setConfig(serverConfig);
                  setCurrentModel(activeModel.name);
                  setSelectedModel(activeModel.name);
                  setStatusText("IOPaint service config reloaded.");
                })}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white/72 transition hover:border-white/20 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  <RefreshCwIcon className="size-4" />
                  Refresh Service State
                </span>
              </button>
            </div>
          </StudioSidebarSection>
        </aside>
      </div>

      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(event) => void onUpload(event.target.files?.[0] || null)}
      />
      <input
        ref={referenceUploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(event) => void onReferenceUpload(event.target.files?.[0] || null)}
      />
      <input
        ref={batchUploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        multiple
        className="hidden"
        onChange={(event) => void handleBatchFiles(Array.from(event.target.files ?? []))}
      />
    </div>
  );
}
