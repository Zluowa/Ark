// @input: active filter value + onChange callback
// @output: All / Connected / Available tab bar
// @position: above ConnectionGrid on Connections page

"use client";

import { useT, type MessageKey } from "@/lib/i18n";

export type ConnectionFilter = "All" | "Connected" | "Available";

const FILTER_KEYS: { value: ConnectionFilter; labelKey: MessageKey }[] = [
  { value: "All", labelKey: "conn.filter.all" },
  { value: "Connected", labelKey: "conn.filter.connected" },
  { value: "Available", labelKey: "conn.filter.available" },
];

interface StatusFilterProps {
  active: ConnectionFilter;
  onChange: (filter: ConnectionFilter) => void;
}

export function StatusFilter({ active, onChange }: StatusFilterProps) {
  const t = useT();
  return (
    <div className="flex gap-1">
      {FILTER_KEYS.map(({ value, labelKey }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            active === value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
