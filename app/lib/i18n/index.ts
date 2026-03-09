// @input: locale store + zh/en dictionaries
// @output: useT() hook for client components
// @position: single public API for i18n system

"use client";

import { useCallback } from "react";
import { useLocaleStore, type Locale } from "./store";
import { zh, type MessageKey } from "./zh";
import { en } from "./en";

const dicts: Record<Locale, Record<MessageKey, string>> = { zh, en };

function interpolate(tpl: string, vars?: Record<string, string | number>): string {
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      interpolate(dicts[locale]?.[key] ?? zh[key], vars),
    [locale],
  );
}

export { useLocaleStore, type Locale, type MessageKey };
