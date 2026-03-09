// @input: Tool result with { prompt, revised_prompt, url, style, size }
// @output: AI image display with prompt info, style badge, and download button
// @position: A2UI widget — renders generate.image tool results

"use client";

import { useEffect, useState, useCallback } from "react";
import { SparklesIcon, DownloadIcon, ImageIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { extractUrl, memoWidget, triggerDownload, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

/* ── Types ── */

type ImageResult = {
  prompt: string;
  revised_prompt: string;
  url: string;
  style: string;
  size: string;
};

const STYLE_COLORS: Record<string, string> = {
  realistic:    "bg-sky-500/20 text-sky-300",
  illustration: "bg-violet-500/20 text-violet-300",
  "3d":         "bg-orange-500/20 text-orange-300",
  pixel:        "bg-green-500/20 text-green-300",
};

/* ── Loading skeleton ── */

const Skeleton = () => (
  <div className="space-y-3 p-3">
    <div className="flex items-center gap-2">
      <SparklesIcon className="size-4 text-fuchsia-400 animate-pulse" />
      <div className="h-3 w-32 animate-pulse rounded bg-zinc-800" />
    </div>
    <div className="relative h-64 overflow-hidden rounded-lg bg-zinc-800">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.5s_infinite] bg-[length:200%_100%]" />
      <div className="flex h-full items-center justify-center">
        <ImageIcon className="size-12 text-zinc-700" />
      </div>
    </div>
    <div className="space-y-1.5">
      <div className="h-2.5 w-3/4 animate-pulse rounded bg-zinc-800" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-zinc-800" />
    </div>
  </div>
);

/* ── Widget ── */

const ImageGeneratorImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<ImageResult | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (status.type !== "complete") return;
    const r = unwrapResult(result) as Record<string, unknown>;
    const url = extractUrl(r);
    if (!url) return;
    setData({
      prompt: String(r.prompt ?? ""),
      revised_prompt: String(r.revised_prompt ?? r.prompt ?? ""),
      url,
      style: String(r.style ?? "realistic"),
      size: String(r.size ?? "1024x1024"),
    });
  }, [result, status.type]);

  const download = useCallback(() => {
    if (!data) return;
    triggerDownload(data.url, `ai-image-${data.style}-${Date.now()}.png`);
  }, [data]);

  const promptChanged = data && data.revised_prompt !== data.prompt;
  const styleBadge = STYLE_COLORS[data?.style ?? ""] ?? STYLE_COLORS.realistic;

  return (
    <DarkShell
      status={status}
      maxWidth="md"
      skeleton={<Skeleton />}
      pill={{ icon: SparklesIcon, label: "Image", accent: "text-fuchsia-400", bgAccent: "bg-fuchsia-500/15" }}
      result={result}
    >
      {data && (
        <div className="space-y-0">
          {/* Image */}
          <div className="relative bg-zinc-950/50 flex items-center justify-center overflow-hidden" style={{ minHeight: 200 }}>
            {!imgLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon className="size-10 text-zinc-700" />
              </div>
            )}
            <img // eslint-disable-line @next/next/no-img-element
              src={data.url}
              alt={data.prompt}
              onLoad={() => setImgLoaded(true)}
              className="max-h-72 w-full object-contain transition-opacity duration-300"
              style={{ opacity: imgLoaded ? 1 : 0 }}
            />
          </div>

          {/* Footer */}
          <div className="border-t border-white/5 px-3 py-2 space-y-1.5">
            {/* Style badge + size + download */}
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${styleBadge}`}>
                {data.style}
              </span>
              <span className="text-[10px] text-zinc-600">{data.size}</span>
              <div className="flex-1" />
              <button
                onClick={download}
                aria-label="Download image"
                className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded"
              >
                <DownloadIcon className="size-3.5" />
              </button>
            </div>

            {/* Prompt */}
            <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2" title={data.prompt}>
              {data.prompt}
            </p>

            {/* Revised prompt (only when DALL-E changed it) */}
            {promptChanged && (
              <p className="text-[10px] text-zinc-600 leading-relaxed line-clamp-2" title={data.revised_prompt}>
                <span className="text-zinc-500">Revised: </span>{data.revised_prompt}
              </p>
            )}
          </div>
        </div>
      )}
    </DarkShell>
  );
};

export const ImageGenerator = memoWidget(ImageGeneratorImpl);
