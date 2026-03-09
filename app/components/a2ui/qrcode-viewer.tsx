// @input: Tool result with { output_url: dataURL, text: string }
// @output: QR code preview with download + copy
// @position: A2UI widget — interactive QR code card

"use client";

import { useCallback, useEffect, useState } from "react";
import { CopyIcon, CheckIcon, DownloadIcon, QrCodeIcon, Loader2Icon, Maximize2 } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { useCopyFeedback } from "./hooks";
import { memoWidget, triggerDownload } from "./utils";
import { WidgetDialog } from "./widget-dialog";

type QrData = { url: string; text: string; size: number };

const QrCodeViewerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [qr, setQr] = useState<QrData | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    if (status.type !== "complete") return;
    const data = result as Record<string, unknown> | undefined;
    if (!data) return;
    const url = String(data.output_url ?? "");
    if (url.startsWith("data:")) {
      setQr({ url, text: String(data.text ?? ""), size: Number(data.width ?? 256) });
    }
  }, [result, status.type]);

  const copyText = useCallback(() => {
    if (!qr) return;
    copy(qr.text);
  }, [qr, copy]);

  const download = useCallback(() => {
    if (!qr) return;
    triggerDownload(qr.url, `qr-${Date.now()}.png`);
  }, [qr]);

  if (status.type === "running") {
    return (
      <div className="my-2 mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-white/8 bg-zinc-900 p-4 shadow-xl">
        <div className="flex items-center justify-center">
          <Loader2Icon className="size-8 animate-spin text-zinc-600" />
        </div>
      </div>
    );
  }

  if (!qr) return null;

  const content = (
    <>
      <div className="flex items-center justify-center p-4">
        <div className="bg-white rounded p-2">
          <img src={qr.url} alt="QR Code" className="size-40 block" /> {/* eslint-disable-line @next/next/no-img-element */}
        </div>
      </div>
      <div className="space-y-1.5 border-t border-white/8 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <QrCodeIcon className="size-3 shrink-0 text-zinc-500" />
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{qr.text}</p>
          <button onClick={copyText} aria-label="Copy text" className="flex min-h-[44px] min-w-[44px] items-center justify-center text-zinc-500 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
          <button onClick={download} aria-label="Download PNG" className="flex min-h-[44px] min-w-[44px] items-center justify-center text-zinc-500 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            <DownloadIcon className="size-3" />
          </button>
        </div>
        <p className="text-[10px] text-zinc-500">{qr.size}×{qr.size}px · PNG</p>
      </div>
    </>
  );

  return (
    <>
      <WidgetDialog open={dialogOpen} onOpenChange={setDialogOpen} title="QR Code" icon={<QrCodeIcon className="size-4" />}>
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

export const QrCodeViewer = memoWidget(QrCodeViewerImpl);
