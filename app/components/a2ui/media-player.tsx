// @input: Tool result with output_url pointing to audio/video/gif
// @output: Custom-styled media player — audio/video/gif, no native browser controls
// @position: A2UI widget for audio and video tools

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PlayIcon, PauseIcon, DownloadIcon, MaximizeIcon,
  Volume2Icon, FileAudioIcon, VideoIcon,
} from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, extractUrl, triggerDownload } from "./utils";
import { DarkShell } from "./dark-shell";

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const detectMode = (toolName: string, url: string): "audio" | "video" | "gif" => {
  if (url.toLowerCase().endsWith(".gif") || toolName === "video_to_gif") return "gif";
  if (toolName.startsWith("audio_") || toolName === "video_extract_audio") return "audio";
  return "video";
};

const extractFilename = (result: unknown, url: string): string => {
  const r = result as Record<string, unknown> | undefined;
  if (r?.filename && typeof r.filename === "string") return r.filename;
  return url.split("/").pop()?.split("?")[0] ?? "media";
};

/* ── Audio Player ── */

const AudioPlayer = ({ url, filename }: { url: string; filename: string }) => {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const h = {
      timeupdate: () => setCurrent(a.currentTime),
      loadedmetadata: () => setDuration(a.duration || 0),
      ended: () => setPlaying(false),
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
    };
    for (const [e, fn] of Object.entries(h)) a.addEventListener(e, fn);
    return () => { for (const [e, fn] of Object.entries(h)) a.removeEventListener(e, fn); };
  }, []);

  const toggle = useCallback(() => {
    const a = ref.current;
    if (!a) return;
    a.paused ? a.play() : a.pause();
  }, []);

  const progress = duration ? (current / duration) * 100 : 0;

  return (
    <>
      <audio ref={ref} src={url} preload="metadata" />
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <FileAudioIcon className="size-3 text-emerald-400 shrink-0" />
        <span className="flex-1 truncate text-[11px] font-medium text-zinc-300">{filename}</span>
        <button onClick={() => triggerDownload(url, filename)} aria-label="Download"
          className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          <DownloadIcon className="size-3" />
        </button>
      </div>
      {/* Controls row */}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
            playing ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30" : "bg-zinc-700/80 text-white hover:bg-zinc-600",
          )}>
          {playing ? <PauseIcon className="size-3.5" fill="currentColor" /> : <PlayIcon className="size-3.5" fill="currentColor" />}
        </button>
        <span className="w-8 text-right text-[10px] tabular-nums text-zinc-500">{fmtTime(current)}</span>
        <input type="range" min={0} max={Math.round(duration) || 1} value={Math.round(current)}
          onChange={(e) => { if (ref.current) ref.current.currentTime = e.target.valueAsNumber; }}
          aria-label="Seek" className="flex-1 h-[3px] cursor-pointer appearance-none rounded-full bg-zinc-800 accent-emerald-500"
          style={{ backgroundImage: `linear-gradient(to right, #10b981 ${progress}%, transparent ${progress}%)` }}
        />
        <span className="w-8 text-[10px] tabular-nums text-zinc-500">{fmtTime(duration)}</span>
        <Volume2Icon className="size-3 text-zinc-600 shrink-0" />
      </div>
    </>
  );
};

/* ── Video Player ── */

const VideoPlayer = ({ url, filename }: { url: string; filename: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const h = {
      timeupdate: () => setCurrent(v.currentTime),
      loadedmetadata: () => setDuration(v.duration || 0),
      ended: () => setPlaying(false),
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
    };
    for (const [e, fn] of Object.entries(h)) v.addEventListener(e, fn);
    return () => { for (const [e, fn] of Object.entries(h)) v.removeEventListener(e, fn); };
  }, []);

  const toggle = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  }, []);

  const progress = duration ? (current / duration) * 100 : 0;

  return (
    <>
      {/* Video area with overlay */}
      <div className="relative bg-black max-h-56 flex items-center justify-center cursor-pointer" onClick={toggle}>
        <video ref={ref} src={url} preload="metadata" className="w-full max-h-56 rounded-t-xl object-contain" />
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-violet-500/80">
              <PlayIcon className="size-5" fill="currentColor" />
            </div>
          </div>
        )}
      </div>
      {/* Bottom bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/5">
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"}
          className="text-zinc-400 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          {playing ? <PauseIcon className="size-3.5" fill="currentColor" /> : <PlayIcon className="size-3.5" fill="currentColor" />}
        </button>
        <span className="text-[10px] tabular-nums text-zinc-500 w-8 text-right">{fmtTime(current)}</span>
        <input type="range" min={0} max={Math.round(duration) || 1} value={Math.round(current)}
          onChange={(e) => { if (ref.current) ref.current.currentTime = e.target.valueAsNumber; }}
          aria-label="Seek" className="flex-1 h-[3px] cursor-pointer appearance-none rounded-full bg-zinc-800 accent-violet-500"
          style={{ backgroundImage: `linear-gradient(to right, #8b5cf6 ${progress}%, transparent ${progress}%)` }}
        />
        <span className="text-[10px] tabular-nums text-zinc-500 w-8">{fmtTime(duration)}</span>
        <button onClick={() => ref.current?.requestFullscreen()} aria-label="Fullscreen"
          className="text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          <MaximizeIcon className="size-3" />
        </button>
        <button onClick={() => triggerDownload(url, filename)} aria-label="Download"
          className="text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          <DownloadIcon className="size-3" />
        </button>
      </div>
    </>
  );
};

/* ── GIF Player ── */

const GifPlayer = ({ url, filename }: { url: string; filename: string }) => (
  <>
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
      <VideoIcon className="size-3 text-pink-400 shrink-0" />
      <span className="flex-1 truncate text-[11px] font-medium text-zinc-300">{filename}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500/10 text-pink-400">GIF</span>
    </div>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt={filename} className="w-full object-contain max-h-56" />
    <div className="flex justify-end px-3 py-1.5 border-t border-white/5">
      <button onClick={() => triggerDownload(url, filename)} aria-label="Download"
        className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
        <DownloadIcon className="size-3" />
        Save
      </button>
    </div>
  </>
);

/* ── Main ── */

const MediaPlayerImpl: ToolCallMessagePartComponent = ({ toolName, result, status }) => {
  const url = extractUrl(result);

  const skeleton = (
    <div className="flex items-center gap-2 p-3">
      <div className="size-8 animate-pulse rounded-full bg-zinc-800" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-zinc-800" />
        <div className="h-1.5 w-full animate-pulse rounded bg-zinc-800" />
      </div>
    </div>
  );

  if (status.type === "complete" && !url) return null;

  const mode = url ? detectMode(toolName, url) : "audio";
  const filename = url ? extractFilename(result, url) : "";

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {mode === "audio" && <AudioPlayer url={url!} filename={filename} />}
      {mode === "gif" && <GifPlayer url={url!} filename={filename} />}
      {mode === "video" && <VideoPlayer url={url!} filename={filename} />}
    </DarkShell>
  );
};

export const MediaPlayer = memoWidget(MediaPlayerImpl);
