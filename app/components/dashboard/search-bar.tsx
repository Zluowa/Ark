// @input: search query state, category filter state from parent
// @output: full-width search input + v5 category tabs
// @position: between API Key card and tool grid on Home page

"use client";

import { Search } from "lucide-react";
import type { ToolCategory } from "@/lib/engine/types";
import { DISPLAY_CATEGORIES } from "@/lib/tools/display";
import { useT } from "@/lib/i18n";

interface SearchBarProps {
  query: string;
  category: "All" | ToolCategory;
  onQueryChange: (q: string) => void;
  onCategoryChange: (c: "All" | ToolCategory) => void;
  totalCount?: number;
}

export function SearchBar({
  query,
  category,
  onQueryChange,
  onCategoryChange,
  totalCount,
}: SearchBarProps) {
  const t = useT();

  const categoryLabel = (c: string) => {
    if (c === "All") return t("search.category.all");
    const key = `category.${c}` as Parameters<typeof t>[0];
    return t(key);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={totalCount ? t("search.placeholder", { count: totalCount }) : t("search.placeholder.default")}
            className="w-full rounded-lg border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:outline-none"
          />
        </div>
        <select className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground focus:outline-none">
          <option>{t("search.sort.az")}</option>
          <option>{t("search.sort.popular")}</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        {DISPLAY_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => onCategoryChange(c)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              category === c
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {categoryLabel(c)}
          </button>
        ))}
      </div>
    </div>
  );
}
