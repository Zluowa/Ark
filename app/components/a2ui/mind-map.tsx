// @input: Tool result with { center: string, branches: Array<{ label, children }> }
// @output: Interactive SVG mind map visualization
// @position: A2UI widget — mind map mini-app

"use client";

import { useEffect, useState } from "react";
import { NetworkIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

// ── Types ──────────────────────────────────────────────────────────────────

type Branch = { label: string; children: string[] };
type MapData = { center: string; branches: Branch[] };

type NodeKind = "center" | "branch" | "leaf";

type NodeConfig = {
  wBase: number; wPer: number; wMax: number;
  h: number; rx: number; fontSize: number;
  fillOpacity: number; strokeOpacity: number; strokeWidth: number;
  fontWeight: number; textColor: string;
};

// ── Color palette ──────────────────────────────────────────────────────────

const PALETTE = [
  { stroke: "#8b5cf6", r: "139,92,246" },
  { stroke: "#ec4899", r: "236,72,153" },
  { stroke: "#3b82f6", r: "59,130,246" },
  { stroke: "#10b981", r: "16,185,129" },
  { stroke: "#f59e0b", r: "245,158,11" },
  { stroke: "#f43f5e", r: "244,63,94" },
];

const hue = (i: number) => PALETTE[i % PALETTE.length];

// ── Node configs (data-driven, no if/else) ─────────────────────────────────

const NODE: Record<NodeKind, NodeConfig> = {
  center: { wBase: 20, wPer: 7.5, wMax: 130, h: 28, rx: 8, fontSize: 11, fillOpacity: 0.35, strokeOpacity: 1, strokeWidth: 2, fontWeight: 700, textColor: "#f4f4f5" },
  branch: { wBase: 16, wPer: 6.5, wMax: 100, h: 22, rx: 5, fontSize: 9.5, fillOpacity: 0.25, strokeOpacity: 1, strokeWidth: 1.2, fontWeight: 600, textColor: "#e4e4e7" },
  leaf:   { wBase: 12, wPer: 6.0, wMax: 90,  h: 18, rx: 4, fontSize: 8.5, fillOpacity: 0.15, strokeOpacity: 0.85, strokeWidth: 1, fontWeight: 500, textColor: "#d4d4d8" },
};

// ── Geometry ───────────────────────────────────────────────────────────────

const CX = 280, CY = 165, R_B = 125, R_L = 210;

const polar = (a: number, r: number) => ({ x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) });

const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
};

// ── SVG primitives ─────────────────────────────────────────────────────────

function MapNode({ label, x, y, kind, colorIdx }: { label: string; x: number; y: number; kind: NodeKind; colorIdx: number }) {
  const cfg = NODE[kind];
  const { stroke, r } = hue(colorIdx);
  const w = Math.min(Math.max(label.length * cfg.wPer + cfg.wBase, 54), cfg.wMax);
  return (
    <g>
      <rect x={x - w / 2} y={y - cfg.h / 2} width={w} height={cfg.h} rx={cfg.rx}
        fill={`rgba(${r},${cfg.fillOpacity})`} stroke={stroke}
        strokeWidth={cfg.strokeWidth} strokeOpacity={cfg.strokeOpacity} />
      <text x={x} y={y + cfg.fontSize * 0.4} textAnchor="middle"
        fontSize={cfg.fontSize} fontWeight={cfg.fontWeight} fill={cfg.textColor}>
        {label}
      </text>
    </g>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────

function buildLayout(branches: Branch[]) {
  const n = branches.length || 1;
  return branches.map((b, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const bp = polar(angle, R_B);
    const span = Math.min(Math.PI / (n + 1), 0.6);
    const leaves = b.children.map((child, j) => {
      const offset = b.children.length > 1 ? span * (j / (b.children.length - 1) - 0.5) : 0;
      return { label: child, ...polar(angle + offset, R_L) };
    });
    return { label: b.label, angle, bx: bp.x, by: bp.y, colorIdx: i, leaves };
  });
}

// ── Mind Map SVG ───────────────────────────────────────────────────────────

function MindMapSVG({ data }: { data: MapData }) {
  const layout = buildLayout(data.branches);
  return (
    <svg viewBox="0 0 560 330" className="w-full" aria-label="Mind map">
      <style>{`
        .mm { animation: mf .4s ease both; }
        @keyframes mf { from { opacity:0; transform:scale(.92); transform-origin:center } to { opacity:1; transform:scale(1) } }
      `}</style>

      {layout.map((b, bi) => (
        <g key={bi}>
          <path className="mm" style={{ animationDelay: `${bi * 55}ms` }}
            d={bezier(CX, CY, b.bx, b.by)} fill="none"
            stroke={hue(b.colorIdx).stroke} strokeWidth={1.8} strokeOpacity={0.65} />
          {b.leaves.map((l, li) => (
            <path key={li} className="mm" style={{ animationDelay: `${bi * 55 + li * 25 + 80}ms` }}
              d={bezier(b.bx, b.by, l.x, l.y)} fill="none"
              stroke={hue(b.colorIdx).stroke} strokeWidth={1.2} strokeOpacity={0.5} />
          ))}
        </g>
      ))}

      {layout.map((b, bi) => (
        <g key={bi} className="mm" style={{ animationDelay: `${bi * 55 + 70}ms` }}>
          <MapNode label={b.label} x={b.bx} y={b.by} kind="branch" colorIdx={b.colorIdx} />
        </g>
      ))}

      {layout.map((b, bi) => b.leaves.map((l, li) => (
        <g key={`${bi}-${li}`} className="mm" style={{ animationDelay: `${bi * 55 + li * 25 + 140}ms` }}>
          <MapNode label={l.label} x={l.x} y={l.y} kind="leaf" colorIdx={b.colorIdx} />
        </g>
      )))}

      <g className="mm">
        <MapNode label={data.center} x={CX} y={CY} kind="center" colorIdx={0} />
      </g>
    </svg>
  );
}

// ── Widget ─────────────────────────────────────────────────────────────────

const skeleton = (
  <div className="px-3 py-2 space-y-2">
    <div className="flex items-center gap-2">
      <div className="size-3 animate-pulse rounded bg-zinc-800" />
      <div className="h-2 w-28 animate-pulse rounded bg-zinc-800" />
    </div>
    <div className="h-44 animate-pulse rounded bg-zinc-800/50" />
  </div>
);

const MindMapImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<MapData | null>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    const branches = json.branches as Branch[] | undefined;
    if (json.center && branches?.length) setData({ center: String(json.center), branches });
  }, [result, status.type]);

  if (!data) return <DarkShell status={status} maxWidth="md" skeleton={skeleton}>{null}</DarkShell>;

  const leafCount = data.branches.reduce((s, b) => s + b.children.length, 0);

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <NetworkIcon className="size-3 text-violet-400" />
        <span className="text-[11px] font-medium text-zinc-300">{data.center}</span>
        <span className="text-[10px] text-zinc-400">
          {data.branches.length} branches · {leafCount} nodes
        </span>
      </div>
      <div className="px-2 pb-2 pt-1">
        <MindMapSVG data={data} />
      </div>
    </DarkShell>
  );
};

export const MindMap = memoWidget(MindMapImpl);
