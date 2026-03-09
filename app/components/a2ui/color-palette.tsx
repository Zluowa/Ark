// @input: Tool result with { colors: string[], base: string }
// @output: Interactive color swatch viewer with copy
// @position: A2UI widget — visual palette explorer

"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CopyIcon, PaletteIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type PaletteData = { base: string; colors: string[]; count: number };

const ColorPaletteImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [palette, setPalette] = useState<PaletteData | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    const colors = json.colors as string[] | undefined;
    if (colors?.length) setPalette({ base: String(json.base ?? ""), colors, count: colors.length });
  }, [result, status.type]);

  const copyColor = useCallback((hex: string, i: number) => {
    navigator.clipboard.writeText(hex);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const contrastColor = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? "#000" : "#fff";
  };

  const skeleton = (
    <div className="flex gap-1.5">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-16 flex-1 animate-pulse rounded-lg bg-zinc-800" style={{ animationDelay: `${i * 100}ms` }} />
      ))}
    </div>
  );

  if (!palette) return null;

  const sel = selected !== null ? palette.colors[selected] : null;

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {/* Color swatches */}
      <div className="flex">
        {palette.colors.map((hex, i) => (
          <button
            key={i}
            onClick={() => setSelected(selected === i ? null : i)}
            onDoubleClick={() => copyColor(hex, i)}
            aria-label={`Color ${hex}${selected === i ? " (selected)" : ""}`}
            className={cn(
              "group relative flex-1 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-inset",
              selected === i ? "flex-[2] h-20" : "h-16",
              i === 0 && "rounded-tl-xl",
              i === palette.colors.length - 1 && "rounded-tr-xl",
            )}
            style={{ backgroundColor: hex }}
          >
            {/* Hover overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: contrastColor(hex) }}>
              {copied === i ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <span className="text-[10px] font-mono font-medium">{hex}</span>
              )}
            </div>
            {/* Selected indicator */}
            {selected === i && (
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2">
                <div className="size-1 rounded-full" style={{ backgroundColor: contrastColor(hex) }} />
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Info bar */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <PaletteIcon className="size-3 text-zinc-600" />
        {sel ? (
          <>
            <div className="size-3 rounded-sm" style={{ backgroundColor: sel }} />
            <span className="font-mono text-[11px] text-zinc-300">{sel}</span>
            <span className="text-[10px] text-zinc-600">rgb({parseInt(sel.slice(1,3),16)}, {parseInt(sel.slice(3,5),16)}, {parseInt(sel.slice(5,7),16)})</span>
            <button onClick={() => copyColor(sel, selected!)} aria-label="Copy color hex" className="ml-auto p-0.5 text-zinc-500 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
              {copied === selected ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </button>
          </>
        ) : (
          <>
            <span className="text-[10px] text-zinc-500">base</span>
            <div className="size-3 rounded-sm" style={{ backgroundColor: palette.base }} />
            <span className="font-mono text-[11px] text-zinc-400">{palette.base}</span>
            <span className="ml-auto text-[10px] text-zinc-500">{palette.count} colors · click to select · double-click to copy</span>
          </>
        )}
      </div>
    </DarkShell>
  );
};

export const ColorPalette = memoWidget(ColorPaletteImpl);
