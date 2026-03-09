// @input: children, status, maxWidth, skeleton, pill metadata, result
// @output: Dark zinc card with running/complete/collapsed states
// @position: Shared container for dark-themed A2UI widgets

"use client";

import { useState, type ReactNode } from "react";
import { ChevronUpIcon, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WidgetPill } from "./widget-pill";
import { WidgetDialog } from "./widget-dialog";
import type { PillMeta } from "./types";

type DarkShellProps = {
  status: { type: string };
  maxWidth?: "sm" | "md";
  skeleton?: ReactNode;
  children: ReactNode;
  pill?: PillMeta;
  result?: unknown;
  defaultCollapsed?: boolean;
  title?: string;
  icon?: ReactNode;
};

export function DarkShell({
  status,
  maxWidth = "md",
  skeleton,
  children,
  pill,
  result,
  defaultCollapsed = false,
  title,
  icon,
}: DarkShellProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [expanded, setExpanded] = useState(false);
  const width = maxWidth === "sm" ? "max-w-sm" : "max-w-md";

  if (status.type === "running") {
    return (
      <div className={cn("my-2 mx-auto w-full overflow-hidden rounded-xl border border-white/8 bg-zinc-900 p-3 shadow-xl", width)}>
        {skeleton ?? <div className="h-16 animate-pulse rounded bg-zinc-800" />}
      </div>
    );
  }

  if (pill && collapsed) {
    return (
      <div className={cn("my-2 mx-auto w-full animate-in fade-in slide-in-from-bottom-1 duration-300", width)}>
        <WidgetPill pill={pill} result={result} onExpand={() => setCollapsed(false)} />
      </div>
    );
  }

  return (
    <>
      <WidgetDialog open={expanded} onOpenChange={setExpanded} title={title} icon={icon}>
        {children}
      </WidgetDialog>

      <div className={cn("group relative my-2 mx-auto w-full overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-xl animate-in fade-in slide-in-from-bottom-1 duration-300", width)}>
        <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5">
          <ExpandButton onExpand={() => setExpanded(true)} />
          {pill && <CollapseButton onCollapse={() => setCollapsed(true)} />}
        </div>
        <div className={cn("transition-opacity", expanded && "opacity-30 pointer-events-none")}>
          {children}
        </div>
      </div>
    </>
  );
}

function ExpandButton({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      aria-label="Expand"
      className="rounded p-1 text-zinc-600 opacity-0 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 group-hover:opacity-100 touch:opacity-100"
    >
      <Maximize2 className="size-3.5" />
    </button>
  );
}

function CollapseButton({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button
      onClick={onCollapse}
      aria-label="Collapse"
      className="rounded p-1 text-zinc-600 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
    >
      <ChevronUpIcon className="size-3.5" />
    </button>
  );
}
