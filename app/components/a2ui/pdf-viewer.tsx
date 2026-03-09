// @input: Tool result with PDF file metadata (url, pages, size, compression)
// @output: Visual PDF card with stats, page badge, and download
// @position: A2UI widget — PDF processing mini-app

"use client";

import { useEffect, useState } from "react";
import { FileTextIcon, LayersIcon, TrendingDownIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, formatBytes } from "./utils";
import { DarkShell } from "./dark-shell";
import { SaveButton } from "./save-button";

type PdfData = {
  url: string | null;
  filename: string;
  pages: number | null;
  sizeBytes: number | null;
  originalBytes: number | null;
  ratio: number | null;
};

const PdfViewerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<PdfData | null>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const r = result as Record<string, unknown> | undefined;
    if (!r) return;
    const url = String(r.output_url ?? r.output_file_url ?? r.url ?? "");
    const filename = String(r.filename ?? r.name ?? "document.pdf");
    const pages = r.pages ? Number(r.pages) : r.page_count ? Number(r.page_count) : null;
    const sizeBytes = r.size_bytes ? Number(r.size_bytes) : null;
    const originalBytes = r.original_size_bytes ? Number(r.original_size_bytes) : null;
    const ratio = r.compression_ratio ? Number(r.compression_ratio) : null;
    setData({ url: url || null, filename, pages, sizeBytes, originalBytes, ratio });
  }, [result, status.type]);

  if (!data) return null;

  const saved = data.ratio ? Math.round(data.ratio * 100) : null;
  const fmtSize = data.sizeBytes ? formatBytes(data.sizeBytes) : null;

  const pdfSkeleton = (
    <div className="flex items-center gap-3">
      <div className="size-10 animate-pulse rounded-lg bg-red-500/10" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-zinc-800" />
        <div className="h-2 w-1/3 animate-pulse rounded bg-zinc-800" />
      </div>
    </div>
  );

  return (
    <DarkShell status={status} maxWidth="sm" skeleton={pdfSkeleton}>
      <div className="flex items-center gap-3 p-3">
        {/* Icon with page badge */}
        <div className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
          <FileTextIcon className="size-5 text-red-400" />
          {data.pages && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {data.pages > 99 ? "99+" : data.pages}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-zinc-200">{data.filename}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {data.pages && (
              <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
                <LayersIcon className="size-2.5" /> {data.pages} pages
              </span>
            )}
            {fmtSize && <span className="text-[10px] text-zinc-500">{fmtSize}</span>}
          </div>
        </div>

        {/* Download */}
        {data.url && <SaveButton url={data.url} filename={data.filename} />}
      </div>

      {/* Compression bar */}
      {saved !== null && saved > 0 && (
        <div className="border-t border-white/5 px-3 py-2 flex items-center gap-2">
          <TrendingDownIcon className="size-3 text-emerald-400" />
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
              style={{ width: `${Math.min(saved, 100)}%` }} />
          </div>
          <span className="text-[10px] font-medium text-emerald-400">{saved}% smaller</span>
        </div>
      )}
    </DarkShell>
  );
};

export const PdfViewer = memoWidget(PdfViewerImpl);
