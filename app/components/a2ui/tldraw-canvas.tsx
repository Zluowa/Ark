// @input: Tool result with optional { topic, shapes }
// @output: Interactive tldraw infinite canvas with dark theme
// @position: A2UI widget — tldraw mini-app

"use client";

import { useCallback, useRef, useState } from "react";
import { PenToolIcon, DownloadIcon, Trash2Icon, Maximize2 } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import dynamic from "next/dynamic";
import { memoWidget, unwrapResult } from "./utils";
import { WidgetDialog } from "./widget-dialog";

// Lazy load tldraw to avoid SSR issues and reduce initial bundle
const TldrawEmbed = dynamic(() => import("./tldraw-embed"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded bg-zinc-800/50" />,
});

// ── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="my-2 mx-auto w-full max-w-md rounded-xl border border-white/8 bg-zinc-900 p-3 shadow-xl">
      <div className="flex items-center gap-2 mb-2">
        <PenToolIcon className="size-3.5 animate-pulse text-violet-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
        <div className="ml-auto h-2.5 w-16 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="h-[300px] animate-pulse rounded bg-zinc-800/50" />
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

const TldrawCanvasImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const data = unwrapResult(result);
  const topic = typeof data.topic === "string" ? data.topic : "Canvas";
  const [dialogOpen, setDialogOpen] = useState(false);
  const exportRef = useRef<(() => void) | null>(null);

  const handleExport = useCallback(() => {
    exportRef.current?.();
  }, []);

  if (status.type === "running") return <Skeleton />;

  const canvas = (
    <TldrawEmbed
      topic={topic}
      onExportReady={(fn) => { exportRef.current = fn; }}
    />
  );

  return (
    <>
      <WidgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={topic}
        icon={<PenToolIcon className="size-4" />}
      >
        <div className="h-full min-h-[600px]">{canvas}</div>
      </WidgetDialog>

      <div className="group relative my-2 mx-auto w-full max-w-md overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-xl animate-in fade-in slide-in-from-bottom-1 duration-300">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
          <PenToolIcon className="size-3 text-violet-400 shrink-0" />
          <span className="text-[11px] font-medium text-zinc-300 truncate">{topic}</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 shrink-0">
            tldraw
          </span>
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <button
              onClick={handleExport}
              aria-label="Export PNG"
              className="rounded p-1 text-zinc-600 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            >
              <DownloadIcon className="size-3" />
            </button>
            <button
              onClick={() => setDialogOpen(true)}
              aria-label="Expand"
              className="rounded p-1 text-zinc-600 opacity-0 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 group-hover:opacity-100"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div
          className="h-[300px] w-full overflow-hidden"
          style={{ touchAction: "none" }}
        >
          {canvas}
        </div>
      </div>
    </>
  );
};

export const TldrawCanvas = memoWidget(TldrawCanvasImpl);
