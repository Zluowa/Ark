// @input: ToolDisplay[] from v5 engine registry passed by Server Component
// @output: searchable, filterable 3-column grid of ToolCard components
// @position: main content area of Home page and /dashboard/tools

"use client";

import { useState } from "react";
import { ToolCard } from "./tool-card";
import { SearchBar } from "./search-bar";
import type { ToolCategory } from "@/lib/engine/types";
import type { ToolDisplay } from "@/lib/tools/display";
import { useLocaleStore, useT } from "@/lib/i18n";
import { getLocalizedToolText } from "@/lib/tools/localization";

interface ToolGridProps {
  tools: ToolDisplay[];
  showSearch?: boolean;
  onToolClick?: (toolId: string) => void;
}

const matchesTool = (tool: ToolDisplay, query: string, locale: "zh" | "en"): boolean => {
  const q = query.toLowerCase();
  const localized = getLocalizedToolText(tool, locale);
  return (
    tool.name.toLowerCase().includes(q) ||
    tool.description.toLowerCase().includes(q) ||
    localized.name.toLowerCase().includes(q) ||
    localized.description.toLowerCase().includes(q) ||
    tool.tags.some((tag) => tag.toLowerCase().includes(q))
  );
};

export function ToolGrid({ tools, showSearch = true, onToolClick }: ToolGridProps) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | ToolCategory>("All");

  const filtered = tools.filter((tool) => {
    const matchesCategory = category === "All" || tool.category === category;
    const matchesQuery = !query || matchesTool(tool, query, locale);
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="flex flex-col gap-4">
      {showSearch && (
        <SearchBar
          query={query}
          category={category}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          totalCount={tools.length}
        />
      )}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            onClick={onToolClick ? () => onToolClick(tool.id) : undefined}
          />
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {query ? t("search.noResults.query", { query }) : t("search.noResults.category")}
        </div>
      )}
    </div>
  );
}
