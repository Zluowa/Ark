// @input: Tool result with { title, language, entries, srt_text } from media.extract_subtitle
// @output: Scrollable subtitle list with timestamps, copy/download, and search filter
// @position: A2UI widget — subtitle/captions viewer mini-app

"use client";

import { useEffect, useMemo, useState } from "react";
import { SubtitlesIcon, DownloadIcon, CopyIcon, CheckIcon, SearchIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult, triggerDownload } from "./utils";
import { useCopyFeedback } from "./hooks";
import { DarkShell } from "./dark-shell";

type Entry = { index: number; start: string; end: string; text: string };
type SubtitleData = { title: string; language: string; entries: Entry[]; srt_text?: string; total_entries: number };

const fmtTimestamp = (ts: string) => ts.replace(",", ".").split(".")[0] ?? ts;

const SubtitleViewerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<SubtitleData | null>(null);
  const [query, setQuery] = useState("");
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    if (status.type !== "complete") return;
    const r = unwrapResult(result);
    if (!Array.isArray(r.entries)) return;
    setData({
      title: String(r.title ?? ""),
      language: String(r.language ?? ""),
      entries: r.entries as Entry[],
      srt_text: r.srt_text ? String(r.srt_text) : undefined,
      total_entries: Number(r.total_entries ?? (r.entries as Entry[]).length),
    });
  }, [result, status.type]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!query.trim()) return data.entries;
    const q = query.toLowerCase();
    return data.entries.filter((e) => e.text.toLowerCase().includes(q));
  }, [data, query]);

  const skeleton = (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <div className="size-3.5 animate-pulse rounded bg-zinc-800" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
      </div>
      {[80, 65, 90, 55, 70].map((w, i) => (
        <div key={i} className="flex gap-2">
          <div className="h-2 w-12 animate-pulse rounded bg-zinc-800/60" />
          <div className="h-2 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );

  if (!data) return <DarkShell status={status} maxWidth="sm" skeleton={skeleton}><div /></DarkShell>;

  const srtContent = data.srt_text ?? data.entries
    .map((e) => `${e.index}\n${e.start} --> ${e.end}\n${e.text}`)
    .join("\n\n");

  const handleDownload = () => {
    const blob = new Blob([srtContent], { type: "text/plain;charset=utf-8" });
    triggerDownload(URL.createObjectURL(blob), `${data.title || "subtitles"}.srt`);
  };

  return (
    <DarkShell status={status} maxWidth="sm" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <SubtitlesIcon className="size-3.5 shrink-0 text-cyan-400" />
        <span className="text-[11px] font-medium text-zinc-300">Subtitles</span>
        {data.language && (
          <span className="rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400">
            {data.language}
          </span>
        )}
        <span className="text-[10px] text-zinc-600">{data.total_entries} entries</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => copy(srtContent)} aria-label="Copy SRT"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-zinc-600 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
            {copied ? <CheckIcon className="size-3 text-emerald-400" /> : <CopyIcon className="size-3" />}
          </button>
          <button onClick={handleDownload} aria-label="Download SRT"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-zinc-600 transition hover:text-cyan-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
            <DownloadIcon className="size-3" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-white/5 px-3 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md bg-zinc-800/50 px-2 py-1">
          <SearchIcon className="size-3 shrink-0 text-zinc-600" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter subtitles..."
            className="flex-1 bg-transparent text-[11px] text-white placeholder-zinc-600 outline-none" />
        </div>
      </div>

      {/* Entries */}
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-zinc-600">No subtitles found</p>
        ) : (
          filtered.map((entry, i) => (
            <div key={entry.index} className={cn("flex gap-2.5 px-3 py-1.5", i < filtered.length - 1 && "border-b border-white/5")}>
              <span className="mt-0.5 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                {fmtTimestamp(entry.start)}
              </span>
              <p className="text-[12px] leading-snug text-zinc-300">{entry.text}</p>
            </div>
          ))
        )}
      </div>
    </DarkShell>
  );
};

export const SubtitleViewer = memoWidget(SubtitleViewerImpl);
