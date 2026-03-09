// @input: PillMeta, result data, expanded state callback
// @output: Compact 36px pill: [icon] [label] [summary] [expand button]
// @position: Collapsed representation of any A2UI widget

"use client";

import { ChevronDownIcon } from "lucide-react";
import type { PillMeta } from "./types";

type WidgetPillProps = {
  pill: PillMeta;
  result?: unknown;
  onExpand: () => void;
};

export function WidgetPill({ pill, result, onExpand }: WidgetPillProps) {
  const { icon: Icon, label, accent, bgAccent, summary } = pill;
  const summaryText = summary && result ? summary(result) : null;
  const truncated = summaryText && summaryText.length > 40
    ? summaryText.slice(0, 40) + "…"
    : summaryText;

  return (
    <button
      onClick={onExpand}
      className="group flex h-9 w-full items-center gap-2 rounded-lg border border-white/8 bg-zinc-900 px-3 text-left transition hover:border-white/15 hover:bg-zinc-800"
    >
      <div className={`flex size-5 shrink-0 items-center justify-center rounded ${bgAccent}`}>
        <Icon className={`size-3 ${accent}`} />
      </div>
      <span className="text-[11px] font-medium text-zinc-300">{label}</span>
      {truncated && (
        <span className="truncate text-[11px] text-zinc-500">{truncated}</span>
      )}
      <ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-zinc-600 transition group-hover:text-zinc-400" />
    </button>
  );
}
