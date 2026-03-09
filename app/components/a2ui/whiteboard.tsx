// @input: Tool result (optional initial config)
// @output: Interactive drawing canvas with color/size/export
// @position: A2UI widget — mini whiteboard mini-app

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PenToolIcon, EraserIcon, DownloadIcon, Trash2Icon, UndoIcon, Maximize2 } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, triggerDownload } from "./utils";
import { WidgetDialog } from "./widget-dialog";

const COLORS = ["#ffffff", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];
const SIZES = [2, 4, 8];

const WhiteboardImpl: ToolCallMessagePartComponent = ({ status }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [color, setColor] = useState("#ffffff");
  const [size, setSize] = useState(2);
  const [eraser, setEraser] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const historyRef = useRef<ImageData[]>([]);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;

  const saveState = useCallback(() => {
    const c = canvasRef.current;
    const context = c?.getContext("2d");
    if (!c || !context) return;
    historyRef.current.push(context.getImageData(0, 0, c.width, c.height));
    if (historyRef.current.length > 30) historyRef.current.shift();
  }, []);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    saveState();
    setDrawing(true);
    lastRef.current = getPos(e);
  }, [saveState]);

  const draw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const c = ctx();
    if (!c) return;
    const pos = getPos(e);
    const last = lastRef.current ?? pos;
    c.beginPath();
    c.moveTo(last.x, last.y);
    c.lineTo(pos.x, pos.y);
    if (eraser) {
      c.globalCompositeOperation = "destination-out";
      c.strokeStyle = "rgba(0,0,0,1)";
    } else {
      c.globalCompositeOperation = "source-over";
      c.strokeStyle = color;
    }
    c.lineWidth = eraser ? size * 3 : size;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.stroke();
    c.globalCompositeOperation = "source-over";
    lastRef.current = pos;
  }, [drawing, color, size, eraser]);

  const stopDraw = useCallback(() => {
    setDrawing(false);
    lastRef.current = null;
  }, []);

  const undo = useCallback(() => {
    const c = canvasRef.current;
    const context = c?.getContext("2d");
    if (!c || !context || historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    context.putImageData(prev, 0, 0);
  }, []);

  const clear = useCallback(() => {
    const c = canvasRef.current;
    const context = c?.getContext("2d");
    if (!c || !context) return;
    saveState();
    context.fillStyle = "#18181b";
    context.fillRect(0, 0, c.width, c.height);
  }, [saveState]);

  const exportPng = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    triggerDownload(c.toDataURL("image/png"), `whiteboard-${Date.now()}.png`);
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    const context = c?.getContext("2d");
    if (!c || !context) return;
    context.fillStyle = "#18181b";
    context.fillRect(0, 0, c.width, c.height);
  }, []);

  if (status.type === "running") {
    return (
      <div className="my-2 mx-auto w-full max-w-sm rounded-xl border border-white/8 bg-zinc-900 p-3 shadow-xl">
        <div className="flex items-center gap-2">
          <PenToolIcon className="size-3.5 animate-pulse text-violet-400" />
          <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
        </div>
        <div className="mt-2 h-32 animate-pulse rounded bg-zinc-800/50" />
      </div>
    );
  }

  const content = (
    <>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/5 overflow-x-auto scrollbar-none">
        <PenToolIcon className="size-3 text-violet-400 shrink-0" />
        <span className="text-[11px] font-medium text-zinc-300 mr-1 shrink-0">Whiteboard</span>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); setEraser(false); }}
              aria-label={`Color ${c}`}
              className={cn("p-2.5 flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30")}>
              <span className={cn("size-3.5 rounded-full border transition", color === c && !eraser ? "border-white scale-125" : "border-zinc-700")}
                style={{ backgroundColor: c }} />
            </button>
          ))}
          <span className="mx-0.5 h-3 w-px bg-zinc-800 shrink-0" />
          {SIZES.map((s) => (
            <button key={s} onClick={() => setSize(s)}
              aria-label={`Brush size ${s}`}
              className={cn("p-2.5 flex items-center justify-center rounded transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30", size === s ? "bg-zinc-700" : "hover:bg-zinc-800")}>
              <span className="rounded-full bg-zinc-300" style={{ width: s + 1, height: s + 1 }} />
            </button>
          ))}
          <span className="mx-0.5 h-3 w-px bg-zinc-800 shrink-0" />
          <button onClick={() => setEraser(!eraser)}
            aria-label={eraser ? "Pen tool" : "Eraser tool"}
            className={cn("p-2.5 flex items-center justify-center rounded transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30", eraser ? "text-violet-400 bg-violet-500/20" : "text-zinc-600 hover:text-white")}>
            <EraserIcon className="size-3" />
          </button>
          <button onClick={undo} aria-label="Undo"
            className="p-2.5 flex items-center justify-center text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"><UndoIcon className="size-3" /></button>
          <button onClick={clear} aria-label="Clear canvas"
            className="p-2.5 flex items-center justify-center text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"><Trash2Icon className="size-3" /></button>
          <button onClick={exportPng} aria-label="Export as PNG"
            className="p-2.5 flex items-center justify-center text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"><DownloadIcon className="size-3" /></button>
        </div>
      </div>
      <canvas ref={canvasRef} width={384} height={240}
        className={cn("block w-full", eraser ? "cursor-cell" : "cursor-crosshair")}
        style={{ touchAction: "none" }}
        onPointerDown={startDraw} onPointerMove={draw} onPointerUp={stopDraw} onPointerLeave={stopDraw} />
    </>
  );

  return (
    <>
      <WidgetDialog open={dialogOpen} onOpenChange={setDialogOpen} title="Whiteboard" icon={<PenToolIcon className="size-4" />}>
        {content}
      </WidgetDialog>
      <div className="group relative my-2 mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-xl animate-in fade-in slide-in-from-bottom-1 duration-300">
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

export const Whiteboard = memoWidget(WhiteboardImpl);
