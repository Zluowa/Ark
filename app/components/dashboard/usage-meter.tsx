// @input: static usage data (requests count, limit, rate)
// @output: progress bar widget showing monthly request usage
// @position: top of /usage page in dashboard

"use client";

import { useT } from "@/lib/i18n";

export function UsageMeter() {
  const t = useT();
  const used = 1247;
  const limit = "unlimited";
  const rateLimit = "10 req/s";
  const percent = 75;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm font-semibold text-foreground">{t("usage.meter")}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {used.toLocaleString()} / {limit}
        </p>
        <p className="text-xs text-muted-foreground">{t("usage.rate", { rate: rateLimit })}</p>
      </div>
    </div>
  );
}
