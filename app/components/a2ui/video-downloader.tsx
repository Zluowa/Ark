// @input: Tool result with video info or download result from media.video_info / media.download_video
// @output: Mini video card with thumbnail, metadata, format pills, and download button
// @position: A2UI widget — video info + download mini-app

"use client";

import { useEffect, useState } from "react";
import { PlayIcon, EyeIcon, ClockIcon, GlobeIcon, MusicIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, formatBytes, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";
import { SaveButton } from "./save-button";

type Format = { format_id: string; ext: string; resolution: string; filesize_approx?: number };
type VideoData = {
  title: string;
  thumbnail: string;
  duration_str: string;
  uploader: string;
  platform: string;
  view_count?: number;
  formats?: Format[];
  subtitles_available?: string[];
  output_url?: string;
  filesize?: number;
  resolution?: string;
};

const PLATFORM_STYLE: Record<string, { label: string; className: string; icon: "B" | "▶" | "♪" | "X" | "◉" | "⊕" }> = {
  bilibili:  { label: "B",  className: "bg-cyan-500/20 text-cyan-400",   icon: "B" },
  youtube:   { label: "▶", className: "bg-red-500/20 text-red-400",     icon: "▶" },
  douyin:    { label: "♪", className: "bg-pink-500/20 text-pink-400",   icon: "♪" },
  tiktok:    { label: "♪", className: "bg-pink-500/20 text-pink-400",   icon: "♪" },
  twitter:   { label: "X",  className: "bg-blue-500/20 text-blue-400",   icon: "X" },
  x:         { label: "X",  className: "bg-blue-500/20 text-blue-400",   icon: "X" },
  instagram: { label: "◉", className: "bg-purple-500/20 text-purple-400", icon: "◉" },
};

const resolutionLabel = (r: string) => {
  const h = parseInt(r.split("x")[1] ?? r, 10);
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  if (h >= 480) return "480p";
  if (h >= 360) return "360p";
  return r;
};

const fmtViews = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

const VideoDownloaderImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<VideoData | null>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const r = unwrapResult(result);
    if (!r.title) return;
    setData({
      title: String(r.title ?? ""),
      thumbnail: String(r.thumbnail ?? ""),
      duration_str: String(r.duration_str ?? ""),
      uploader: String(r.uploader ?? ""),
      platform: String(r.platform ?? "").toLowerCase(),
      view_count: r.view_count ? Number(r.view_count) : undefined,
      formats: Array.isArray(r.formats) ? (r.formats as Format[]) : undefined,
      subtitles_available: Array.isArray(r.subtitles_available) ? (r.subtitles_available as string[]) : undefined,
      output_url: r.output_url ? String(r.output_url) : r.output_file_url ? String(r.output_file_url) : undefined,
      filesize: r.filesize ? Number(r.filesize) : undefined,
      resolution: r.resolution ? String(r.resolution) : undefined,
    });
  }, [result, status.type]);

  const skeleton = (
    <div className="space-y-2">
      <div className="h-32 w-full animate-pulse rounded-lg bg-zinc-800" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-zinc-800" />
    </div>
  );

  if (!data) return (
    <DarkShell status={status} maxWidth="sm" skeleton={skeleton}>
      <p className="px-3 py-4 text-center text-xs text-zinc-500">视频信息获取失败</p>
    </DarkShell>
  );

  const platform = PLATFORM_STYLE[data.platform] ?? { label: "⊕", className: "bg-zinc-500/20 text-zinc-400", icon: "⊕" as const };
  const uniqueFormats = data.formats
    ? [...new Map(data.formats.map((f) => [resolutionLabel(f.resolution), f])).values()].slice(0, 4)
    : [];

  return (
    <DarkShell status={status} maxWidth="sm" skeleton={skeleton}>
      {/* Thumbnail */}
      <div className="relative w-full overflow-hidden rounded-t-xl" style={{ maxHeight: 160 }}>
        {data.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.thumbnail} alt={data.title} className="w-full object-cover" style={{ maxHeight: 160 }} />
        ) : (
          <div className="flex h-32 items-center justify-center bg-zinc-800">
            <PlayIcon className="size-8 text-zinc-600" />
          </div>
        )}
        {/* Platform badge */}
        <span className={cn("absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-bold", platform.className)}>
          {platform.label}
        </span>
        {/* Duration badge */}
        {data.duration_str && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {data.duration_str}
          </span>
        )}
      </div>

      {/* Info + download */}
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12px] font-medium leading-snug text-zinc-200">{data.title}</p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-500">{data.uploader}</p>
        </div>
        {data.output_url && (
          <SaveButton url={data.output_url} filename={`${data.title}.mp4`} />
        )}
      </div>

      {/* Format pills */}
      {uniqueFormats.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-white/5 px-3 py-2">
          {uniqueFormats.map((f) => (
            <span key={f.format_id} className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400">
              {resolutionLabel(f.resolution)}
              {f.filesize_approx ? ` · ${formatBytes(f.filesize_approx)}` : ""}
            </span>
          ))}
          {data.subtitles_available && data.subtitles_available.length > 0 && (
            <span className="rounded-full bg-zinc-700/60 px-2 py-0.5 text-[10px] text-zinc-400">
              <MusicIcon className="mr-0.5 inline size-2.5" />
              {data.subtitles_available.length} subs
            </span>
          )}
        </div>
      )}

      {/* Footer stats */}
      <div className="flex items-center gap-3 border-t border-white/5 px-3 py-1.5">
        <span className={cn("flex items-center gap-1 text-[10px]", platform.className)}>
          <GlobeIcon className="size-2.5" />
          {data.platform}
        </span>
        {data.view_count !== undefined && (
          <span className="flex items-center gap-1 text-[10px] text-zinc-500">
            <EyeIcon className="size-2.5" />
            {fmtViews(data.view_count)}
          </span>
        )}
        {data.duration_str && (
          <span className="flex items-center gap-1 text-[10px] text-zinc-500">
            <ClockIcon className="size-2.5" />
            {data.duration_str}
          </span>
        )}
        {data.filesize && (
          <span className="ml-auto text-[10px] text-zinc-500">{formatBytes(data.filesize)}</span>
        )}
      </div>
    </DarkShell>
  );
};

export const VideoDownloader = memoWidget(VideoDownloaderImpl);
