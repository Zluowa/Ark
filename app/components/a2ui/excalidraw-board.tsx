// @input: Tool result with optional { topic }
// @output: Interactive SVG vector drawing board (Excalidraw-style)
// @position: A2UI widget — excalidraw vector board mini-app

"use client";

import { useCallback, useRef, useState } from "react";
import {
  PencilRulerIcon, SquareIcon, CircleIcon, TypeIcon,
  MousePointerIcon, MinusIcon, DownloadIcon, Trash2Icon, UndoIcon, Maximize2,
} from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, triggerDownload, unwrapResult } from "./utils";
import { WidgetDialog } from "./widget-dialog";

// ── Types ──────────────────────────────────────────────────────────────────

type Shape =
  | { type: "rect";   x: number; y: number; w: number; h: number; color: string }
  | { type: "circle"; cx: number; cy: number; rx: number; ry: number; color: string }
  | { type: "line";   x1: number; y1: number; x2: number; y2: number; color: string }
  | { type: "text";   x: number; y: number; text: string; color: string }
  | { type: "path";   d: string; color: string };

type Tool = "select" | "rect" | "circle" | "line" | "text" | "pen";

const COLORS = ["#ffffff", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6"];

const TOOLS: { id: Tool; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "select", Icon: MousePointerIcon },
  { id: "rect",   Icon: SquareIcon },
  { id: "circle", Icon: CircleIcon },
  { id: "line",   Icon: MinusIcon },
  { id: "text",   Icon: TypeIcon },
  { id: "pen",    Icon: PencilRulerIcon },
];

// ── Shape renderers ────────────────────────────────────────────────────────

function renderShape(s: Shape, key: string | number, selected = false) {
  const sel = selected ? { strokeDasharray: "4 2", opacity: 0.9 } : {};
  const common = { strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.5, fill: "none" };

  if (s.type === "rect")
    return <rect key={key} x={s.x} y={s.y} width={s.w} height={s.h} stroke={s.color} {...common} {...sel} />;
  if (s.type === "circle")
    return <ellipse key={key} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} stroke={s.color} {...common} {...sel} />;
  if (s.type === "line")
    return <line key={key} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} {...common} {...sel} />;
  if (s.type === "text")
    return <text key={key} x={s.x} y={s.y} fill={s.color} fontSize={14} fontFamily="monospace" {...sel}>{s.text}</text>;
  if (s.type === "path")
    return <path key={key} d={s.d} stroke={s.color} {...common} {...sel} />;
}

// ── Shape hit-test for select tool ────────────────────────────────────────

function hitTest(s: Shape, x: number, y: number): boolean {
  const pad = 6;
  if (s.type === "rect")    return x >= s.x - pad && x <= s.x + s.w + pad && y >= s.y - pad && y <= s.y + s.h + pad;
  if (s.type === "circle")  return Math.abs(x - s.cx) <= s.rx + pad && Math.abs(y - s.cy) <= s.ry + pad;
  if (s.type === "line")    return Math.abs((s.y2 - s.y1) * x - (s.x2 - s.x1) * y + s.x2 * s.y1 - s.y2 * s.x1) / Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < pad;
  if (s.type === "text")    return x >= s.x - pad && x <= s.x + 80 && y >= s.y - 16 && y <= s.y + pad;
  return false;
}

// ── SVG export to PNG ──────────────────────────────────────────────────────

function exportPng(svgEl: SVGSVGElement) {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = svgEl.clientWidth * 2;
    canvas.height = svgEl.clientHeight * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    triggerDownload(canvas.toDataURL("image/png"), `excalidraw-${Date.now()}.png`);
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
}

// ── Main component ─────────────────────────────────────────────────────────

const ExcalidrawBoardImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const data = unwrapResult(result);
  const topic = typeof data.topic === "string" ? data.topic : undefined;

  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool]       = useState<Tool>("pen");
  const [color, setColor]     = useState("#ffffff");
  const [shapes, setShapes]   = useState<Shape[]>([]);
  const [preview, setPreview] = useState<Shape | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // drag state refs — no re-render needed mid-drag
  const dragRef = useRef<{ startX: number; startY: number; shapeIdx?: number; penPts?: string[] } | null>(null);

  const getSvgPos = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    const { x, y } = getSvgPos(e);

    if (tool === "text") {
      const text = window.prompt("Enter text:");
      if (text?.trim()) setShapes(prev => [...prev, { type: "text", x, y, text: text.trim(), color }]);
      return;
    }
    if (tool === "select") {
      const idx = [...shapes].reverse().findIndex(s => hitTest(s, x, y));
      const realIdx = idx === -1 ? -1 : shapes.length - 1 - idx;
      setSelected(realIdx === -1 ? null : realIdx);
      dragRef.current = { startX: x, startY: y, shapeIdx: realIdx === -1 ? undefined : realIdx };
      return;
    }
    if (tool === "pen") {
      dragRef.current = { startX: x, startY: y, penPts: [`M${x},${y}`] };
      setPreview({ type: "path", d: `M${x},${y}`, color });
      return;
    }
    dragRef.current = { startX: x, startY: y };
    setPreview(buildPreview(tool, x, y, x, y, color));
  }, [tool, color, shapes, getSvgPos]);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const { x, y } = getSvgPos(e);
    const { startX, startY } = dragRef.current;

    if (tool === "select" && dragRef.current.shapeIdx !== undefined) {
      const idx = dragRef.current.shapeIdx;
      const dx = x - startX, dy = y - startY;
      dragRef.current.startX = x;
      dragRef.current.startY = y;
      setShapes(prev => prev.map((s, i) => i === idx ? moveShape(s, dx, dy) : s));
      return;
    }
    if (tool === "pen" && dragRef.current.penPts) {
      dragRef.current.penPts.push(`L${x},${y}`);
      setPreview({ type: "path", d: dragRef.current.penPts.join(" "), color });
      return;
    }
    setPreview(buildPreview(tool, startX, startY, x, y, color));
  }, [tool, color, getSvgPos]);

  const onPointerUp = useCallback(() => {
    if (preview && tool !== "select") setShapes(prev => [...prev, preview]);
    dragRef.current = null;
    setPreview(null);
  }, [preview, tool]);

  const undo = useCallback(() => setShapes(prev => prev.slice(0, -1)), []);
  const clear = useCallback(() => { setShapes([]); setSelected(null); }, []);
  const doExport = useCallback(() => { if (svgRef.current) exportPng(svgRef.current); }, []);

  if (status.type === "running") {
    return (
      <div className="my-2 mx-auto w-full max-w-sm rounded-xl border border-white/8 bg-zinc-900 p-3 shadow-xl">
        <div className="flex items-center gap-2">
          <PencilRulerIcon className="size-3.5 animate-pulse text-violet-400" />
          <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
        </div>
        <div className="mt-2 h-40 animate-pulse rounded bg-zinc-800/50" />
      </div>
    );
  }

  const content = (
    <>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/5 overflow-x-auto scrollbar-none">
        <PencilRulerIcon className="size-3 text-violet-400 shrink-0" />
        <span className="text-[11px] font-medium text-zinc-300 mr-1 shrink-0">
          {topic ?? "Draw"}
        </span>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {TOOLS.map(({ id, Icon }) => (
            <button key={id} onClick={() => setTool(id)} aria-label={id}
              className={cn("p-2 flex items-center justify-center rounded transition focus-visible:outline-none", tool === id ? "bg-zinc-700 text-white" : "text-zinc-600 hover:text-white")}>
              <Icon className="size-3" />
            </button>
          ))}
          <span className="mx-0.5 h-3 w-px bg-zinc-800 shrink-0" />
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
              className="p-2 flex items-center justify-center focus-visible:outline-none">
              <span className={cn("size-3 rounded-full border transition", color === c ? "border-white scale-125" : "border-zinc-700")}
                style={{ backgroundColor: c }} />
            </button>
          ))}
          <span className="mx-0.5 h-3 w-px bg-zinc-800 shrink-0" />
          <button onClick={undo} aria-label="Undo"
            className="p-2 flex items-center justify-center text-zinc-600 hover:text-white transition"><UndoIcon className="size-3" /></button>
          <button onClick={clear} aria-label="Clear"
            className="p-2 flex items-center justify-center text-zinc-600 hover:text-white transition"><Trash2Icon className="size-3" /></button>
          <button onClick={doExport} aria-label="Export PNG"
            className="p-2 flex items-center justify-center text-zinc-600 hover:text-white transition"><DownloadIcon className="size-3" /></button>
        </div>
      </div>
      <svg ref={svgRef} width="384" height="256"
        className={cn("block w-full bg-zinc-950", tool === "select" ? "cursor-default" : "cursor-crosshair")}
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        {shapes.map((s, i) => renderShape(s, i, i === selected))}
        {preview && renderShape(preview, "preview")}
      </svg>
    </>
  );

  return (
    <>
      <WidgetDialog open={dialogOpen} onOpenChange={setDialogOpen} title={topic ?? "Excalidraw"} icon={<PencilRulerIcon className="size-4" />}>
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

// ── Pure helpers (no hooks, easy to unit-test) ─────────────────────────────

function buildPreview(tool: Tool, x0: number, y0: number, x1: number, y1: number, color: string): Shape | null {
  if (tool === "rect")   return { type: "rect",   x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), color };
  if (tool === "circle") return { type: "circle", cx: (x0 + x1) / 2,  cy: (y0 + y1) / 2,  rx: Math.abs(x1 - x0) / 2, ry: Math.abs(y1 - y0) / 2, color };
  if (tool === "line")   return { type: "line",   x1: x0, y1: y0, x2: x1, y2: y1, color };
  return null;
}

function moveShape(s: Shape, dx: number, dy: number): Shape {
  if (s.type === "rect")   return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.type === "circle") return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  if (s.type === "line")   return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  if (s.type === "text")   return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.type === "path")   return { ...s, d: s.d.replace(/([ML])([\d.]+),([\d.]+)/g, (_, cmd, x, y) => `${cmd}${+x + dx},${+y + dy}`) };
  return s;
}

export const ExcalidrawBoard = memoWidget(ExcalidrawBoardImpl);
