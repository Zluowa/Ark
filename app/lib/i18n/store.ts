// @input: localStorage key "omniagent-locale"
// @output: { locale, setLocale } global language state
// @position: i18n state core, consumed by useT

"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Locale = "zh" | "en";

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      locale: "zh",
      setLocale: (locale) => set({ locale }),
    }),
    { name: "omniagent-locale" },
  ),
);
