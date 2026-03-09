// @input: useLocaleStore
// @output: compact ZH/EN toggle button
// @position: dashboard header, next to ThemeToggle

"use client";

import { useT, useLocaleStore } from "@/lib/i18n";

export function LangToggle() {
  const { locale, setLocale } = useLocaleStore();
  const t = useT();
  const next = locale === "zh" ? "en" : "zh";

  return (
    <button
      onClick={() => setLocale(next)}
      className="flex size-8 items-center justify-center rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label={`Switch to ${next === "zh" ? "Chinese" : "English"}`}
    >
      {t("lang.label")}
    </button>
  );
}
