// @input: ToolDisplay[] from server component
// @output: Tool grid — click navigates to standalone tool page
// @position: Client-side tools page — handles navigation

"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ToolGrid } from "@/components/dashboard/tool-grid";
import type { ToolDisplay } from "@/lib/tools/display";
import { useT } from "@/lib/i18n";

export function ToolsPageClient({ tools }: { tools: ToolDisplay[] }) {
  const t = useT();
  const router = useRouter();
  const handleClick = useCallback((id: string) => {
    router.push(`/dashboard/tools/${id}`);
  }, [router]);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">{t("page.tools")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("page.tools.subtitle", { count: tools.length })}
        </p>
      </div>
      <ToolGrid tools={tools} showSearch onToolClick={handleClick} />
    </>
  );
}
