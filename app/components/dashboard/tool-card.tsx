// @input: ToolDisplay data from v5 engine registry
// @output: single tool card with category badge and metadata
// @position: grid item inside ToolGrid

"use client";

import { cn } from "@/lib/utils";
import {
  FileText, Image, Film, Music, ArrowLeftRight,
  Lock, Hash, Sparkles, Globe, Plug, ArrowUpRight,
} from "lucide-react";
import type { ToolCategory } from "@/lib/engine/types";
import type { ToolDisplay } from "@/lib/tools/display";
import { CATEGORY_ICONS } from "@/lib/tools/display";
import { useLocaleStore, useT } from "@/lib/i18n";
import { getLocalizedToolText, getOutputTypeLabel } from "@/lib/tools/localization";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  FileText, Image, Film, Music, ArrowLeftRight,
  Lock, Hash, Sparkles, Globe, Plug,
};

interface ToolCardProps {
  tool: ToolDisplay;
  onClick?: () => void;
}

export function ToolCard({ tool, onClick }: ToolCardProps) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const iconName = CATEGORY_ICONS[tool.category] ?? "Plug";
  const Icon = ICON_MAP[iconName] ?? Plug;
  const key = `category.${tool.category}` as Parameters<typeof t>[0];
  const label = t(key);
  const localized = getLocalizedToolText(tool, locale);
  const outputTypeLabel = getOutputTypeLabel(tool.outputType, locale);

  return (
    <div
      className={cn(
        "group flex h-full flex-col rounded-2xl border border-border/70 bg-card p-4 transition-all hover:border-border hover:bg-muted/30",
        onClick && "cursor-pointer",
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex size-9 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground">
          <Icon className="size-4" strokeWidth={1.8} />
        </div>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
          {label}
        </span>
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium leading-5 text-foreground">{localized.name}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground line-clamp-2">
          {localized.description}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/70">
          {t("tool.params", { count: tool.paramCount })} · {outputTypeLabel}
        </span>
        <ArrowUpRight className="size-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  );
}

// Re-export for backwards compatibility
export type { ToolCategory };
export type Tool = ToolDisplay;
