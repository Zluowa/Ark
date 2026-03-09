// @input: Tool result with { original, modified, diff, language }
// @output: Side-by-side or unified diff with line highlights
// @position: A2UI widget — code comparison mini-app

"use client";

import { useCallback, useEffect, useState } from "react";
import { GitCompareArrowsIcon, CopyIcon, CheckIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { useCopyFeedback } from "./hooks";
import { memoWidget } from "./utils";
import { DarkShell } from "./dark-shell";

type DiffLine = { type: "add" | "remove" | "context"; text: string; lineNum: number };
type DiffData = { lines: DiffLine[]; stats: { added: number; removed: number }; language: string };

const parseDiff = (raw: string): DiffData => {
  const lines: DiffLine[] = [];
  let added = 0, removed = 0, num = 0;
  for (const line of raw.split("\n")) {
    num++;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.push({ type: "add", text: line.slice(1), lineNum: num });
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      lines.push({ type: "remove", text: line.slice(1), lineNum: num });
      removed++;
    } else if (!line.startsWith("@@") && !line.startsWith("diff") && !line.startsWith("index")) {
      lines.push({ type: "context", text: line.startsWith(" ") ? line.slice(1) : line, lineNum: num });
    }
  }
  return { lines, stats: { added, removed }, language: "" };
};

const DiffViewerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<DiffData | null>(null);
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    if (status.type !== "complete") return;
    const r = result as Record<string, unknown> | undefined;
    if (!r) return;
    const raw = String(r.diff ?? r.output ?? r.text ?? "");
    if (!raw) return;
    const d = parseDiff(raw);
    d.language = String(r.language ?? "");
    setData(d);
  }, [result, status.type]);

  const copyDiff = useCallback(() => {
    if (!data) return;
    const text = data.lines.map((l) => `${l.type === "add" ? "+" : l.type === "remove" ? "-" : " "}${l.text}`).join("\n");
    copy(text);
  }, [data, copy]);

  if (!data || data.lines.length === 0) return null;

  const diffSkeleton = (
    <>
      <div className="flex items-center gap-2">
        <GitCompareArrowsIcon className="size-3.5 animate-pulse text-amber-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-2 space-y-1">
        {[90, 70, 80, 50, 60].map((w, i) => <div key={i} className="h-2 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%` }} />)}
      </div>
    </>
  );

  return (
    <DarkShell status={status} maxWidth="md" skeleton={diffSkeleton}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <GitCompareArrowsIcon className="size-3 text-amber-400" />
        <span className="text-[11px] font-medium text-zinc-300">Diff</span>
        {data.language && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{data.language}</span>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-emerald-400">+{data.stats.added}</span>
          <span className="text-[10px] text-red-400">-{data.stats.removed}</span>
          <button onClick={copyDiff} aria-label="Copy diff" className="flex min-h-[44px] min-w-[44px] items-center justify-center text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      </div>

      {/* Diff lines */}
      <div className="max-h-64 overflow-auto">
        {data.lines.map((line, i) => (
          <div key={i} className={cn(
            "flex font-mono text-[11px] leading-5",
            line.type === "add" && "bg-emerald-500/12 text-emerald-300",
            line.type === "remove" && "bg-red-500/12 text-red-300",
            line.type === "context" && "text-zinc-500",
          )}>
            <span className={cn(
              "w-5 shrink-0 text-center text-[10px] leading-5 select-none",
              line.type === "add" ? "text-emerald-600" : line.type === "remove" ? "text-red-600" : "text-zinc-700",
            )}>
              {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
            </span>
            <pre className="flex-1 px-2 whitespace-pre-wrap break-all">{line.text}</pre>
          </div>
        ))}
      </div>
    </DarkShell>
  );
};

export const DiffViewer = memoWidget(DiffViewerImpl);
