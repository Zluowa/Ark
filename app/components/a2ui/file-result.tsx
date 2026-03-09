// @input: Tool result with output_url or output_file_url
// @output: File download card with icon and metadata
// @position: A2UI widget for PDF and other file-output tools

"use client";

import { useState } from "react";
import { FileIcon, Maximize2 } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { extractUrl, memoWidget } from "./utils";
import { SaveButton } from "./save-button";
import { WidgetDialog } from "./widget-dialog";

const extractMeta = (result: unknown): { filename: string; detail: string } => {
  if (!result || typeof result !== "object") {
    return { filename: "Processed file", detail: "" };
  }

  const record = result as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof record.count === "number") parts.push(`${record.count} files`);
  if (typeof record.processed_count === "number") {
    parts.push(`${record.processed_count} done`);
  }
  if (typeof record.failed_count === "number" && record.failed_count > 0) {
    parts.push(`${record.failed_count} failed`);
  }
  if (typeof record.pages === "number") parts.push(`${record.pages} pages`);
  if (typeof record.size_bytes === "number") {
    const size = record.size_bytes as number;
    parts.push(
      size < 1024
        ? `${size} B`
        : size < 1048576
          ? `${(size / 1024).toFixed(1)} KB`
          : `${(size / 1048576).toFixed(1)} MB`,
    );
  }
  if (typeof record.compression_ratio === "number") {
    parts.push(`${Math.round((record.compression_ratio as number) * 100)}% smaller`);
  }
  if (typeof record.detail_text === "string" && record.detail_text.trim()) {
    parts.push(record.detail_text.trim());
  }

  return {
    filename: typeof record.filename === "string" ? record.filename : "Processed file",
    detail: parts.join(" · "),
  };
};

const FileResultImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const url = extractUrl(result);
  const meta = extractMeta(result);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (status.type === "running") {
    return (
      <div className="my-2 mx-auto w-full max-w-sm rounded-xl border border-white/8 bg-zinc-900 p-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="size-10 animate-pulse rounded-lg bg-red-500/10" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-2/3 animate-pulse rounded bg-zinc-800" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-zinc-800" />
          </div>
        </div>
      </div>
    );
  }

  const content = (
    <div className="flex items-center gap-3 p-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
        <FileIcon className="size-5 text-red-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-zinc-200">{meta.filename}</p>
        {meta.detail && (
          <p className="mt-0.5 text-[10px] text-zinc-500">{meta.detail}</p>
        )}
      </div>
      {url && <SaveButton url={url} filename={meta.filename} />}
    </div>
  );

  return (
    <>
      <WidgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={meta.filename}
        icon={<FileIcon className="size-4" />}
      >
        {content}
      </WidgetDialog>
      <div className="group relative my-2 mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-xl animate-in fade-in slide-in-from-bottom-1 duration-300">
        <button
          onClick={() => setDialogOpen(true)}
          aria-label="Expand"
          className="absolute right-2 top-2 z-10 rounded p-1 text-zinc-600 opacity-0 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 group-hover:opacity-100 touch:opacity-100"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <div className={cn("transition-opacity", dialogOpen && "opacity-30 pointer-events-none")}>
          {content}
        </div>
      </div>
    </>
  );
};

export const FileResult = memoWidget(FileResultImpl);
