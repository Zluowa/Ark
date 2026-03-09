// @input: Tool result with image data (base64/url/file)
// @output: Canvas-based image viewer with filters and download
// @position: A2UI widget — image processing mini-app

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageIcon,
  DownloadIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  Maximize2,
  WandSparklesIcon,
} from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, triggerDownload, extractUrl } from "./utils";
import { WidgetDialog } from "./widget-dialog";

type StudioImage = { src: string; name: string; width?: number; height?: number; size?: string };
type Filters = { brightness: number; contrast: number; saturate: number; blur: number };

const DEFAULT_FILTERS: Filters = { brightness: 100, contrast: 100, saturate: 100, blur: 0 };

const ImageStudioImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [img, setImg] = useState<StudioImage | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [studioUrl, setStudioUrl] = useState<string>("");

  useEffect(() => {
    if (status.type !== "complete") return;
    const data = result as Record<string, unknown> | undefined;
    if (!data) return;
    const src = extractUrl(data) ?? String(data.output ?? "");
    if (src) {
      const explicitStudioUrl =
        typeof data.studio_url === "string" && data.studio_url.trim()
          ? data.studio_url.trim()
          : "";
      setImg({
        src,
        name: String(data.filename ?? data.name ?? "image"),
        width: data.width ? Number(data.width) : undefined,
        height: data.height ? Number(data.height) : undefined,
        size: data.size ? String(data.size) : undefined,
      });
      setStudioUrl(
        explicitStudioUrl ||
          `/dashboard/tools/image.iopaint_studio?source=${encodeURIComponent(src)}`,
      );
    }
  }, [result, status.type]);

  const filterStyle = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) blur(${filters.blur}px)`;

  const download = useCallback(() => {
    if (!img) return;
    triggerDownload(img.src, img.name.includes(".") ? img.name : `${img.name}.png`);
  }, [img]);

  const openStudio = useCallback(() => {
    if (!studioUrl) return;
    window.open(studioUrl, "_blank", "noopener,noreferrer");
  }, [studioUrl]);

  const updateFilter = useCallback((key: keyof Filters, value: number) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  if (status.type === "running") {
    return (
      <div className="my-2 mx-auto w-full max-w-sm rounded-xl border border-white/8 bg-zinc-900 p-3 shadow-xl">
        <div className="h-40 animate-pulse rounded-lg bg-zinc-800 flex items-center justify-center">
          <ImageIcon className="size-8 text-zinc-700" />
        </div>
      </div>
    );
  }

  if (!img) return null;

  const SLIDERS: Array<{ key: keyof Filters; label: string; min: number; max: number; unit: string }> = [
    { key: "brightness", label: "Bright", min: 0, max: 200, unit: "%" },
    { key: "contrast", label: "Contrast", min: 0, max: 200, unit: "%" },
    { key: "saturate", label: "Saturate", min: 0, max: 200, unit: "%" },
    { key: "blur", label: "Blur", min: 0, max: 10, unit: "px" },
  ];

  const content = (
    <>
      <div className="relative flex items-center justify-center bg-zinc-950/50 p-2 overflow-hidden" style={{ minHeight: 160 }}>
        <img // eslint-disable-line @next/next/no-img-element
          src={img.src} alt={img.name}
          className="max-h-48 max-w-full rounded object-contain transition-all duration-200"
          style={{ filter: filterStyle, transform: `rotate(${rotation}deg)` }}
        />
        <canvas ref={canvasRef} className="hidden" />
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-white/5">
        <ImageIcon className="size-3 text-cyan-400" />
        <span className="text-[10px] text-zinc-400 truncate flex-1">
          {img.name}
          {img.width && img.height ? ` · ${img.width}×${img.height}` : ""}
          {img.size ? ` · ${img.size}` : ""}
        </span>
        <button onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotate image" className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          <RotateCwIcon className="size-3" />
        </button>
        <button onClick={() => setShowFilters(!showFilters)} aria-label="Toggle filters" aria-expanded={showFilters} className={cn("p-1 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded", showFilters ? "text-cyan-400" : "text-zinc-600 hover:text-white")}>
          <SlidersHorizontalIcon className="size-3" />
        </button>
        <button onClick={openStudio} aria-label="Open IOPaint Studio" disabled={!studioUrl} className="p-1 text-zinc-600 hover:text-white transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          <WandSparklesIcon className="size-3" />
        </button>
        <button onClick={download} aria-label="Download image" className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          <DownloadIcon className="size-3" />
        </button>
      </div>
      {showFilters && (
        <div className="space-y-1.5 border-t border-white/5 px-3 py-2">
          {SLIDERS.map(({ key, label, min, max, unit }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-14 text-[10px] text-zinc-500">{label}</span>
              <input type="range" min={min} max={max} value={filters[key]}
                aria-label={label}
                onChange={(e) => updateFilter(key, Number(e.target.value))}
                className="h-0.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-500 [&::-webkit-slider-thumb]:size-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white" />
              <span className="w-8 text-right text-[10px] text-zinc-600">{filters[key]}{unit}</span>
            </div>
          ))}
          <button onClick={() => setFilters(DEFAULT_FILTERS)} aria-label="Reset filters" className="text-[10px] text-zinc-600 hover:text-zinc-400 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            Reset
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <WidgetDialog open={dialogOpen} onOpenChange={setDialogOpen} title={img.name} icon={<ImageIcon className="size-4" />}>
        {content}
      </WidgetDialog>
      <div className="group relative my-2 mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-xl">
        <button onClick={() => setDialogOpen(true)} aria-label="Expand"
          className="absolute right-2 top-2 z-10 rounded p-1 text-zinc-600 opacity-0 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 group-hover:opacity-100 touch:opacity-100">
          <Maximize2 className="size-3.5" />
        </button>
        <div className={cn("transition-opacity", dialogOpen && "opacity-30 pointer-events-none")}>
          {content}
        </div>
      </div>
    </>
  );
};

export const ImageStudio = memoWidget(ImageStudioImpl);
