// @input: pricing data (static), UsageMeter component
// @output: Usage page with usage meter and Hobby/Enterprise plan cards
// @position: /usage route in dashboard

"use client";

import { Check } from "lucide-react";
import { UsageMeter } from "@/components/dashboard/usage-meter";
import { useT, type MessageKey } from "@/lib/i18n";

const PLAN_DEFS: { nameKey: MessageKey; priceKey: MessageKey; current: boolean; featureKeys: MessageKey[] }[] = [
  {
    nameKey: "usage.plan.hobby",
    priceKey: "usage.plan.free",
    current: true,
    featureKeys: ["usage.feature.unlimited", "usage.feature.rateLimit", "usage.feature.community", "usage.feature.freeForever"],
  },
  {
    nameKey: "usage.plan.enterprise",
    priceKey: "usage.plan.custom",
    current: false,
    featureKeys: ["usage.feature.customPlans", "usage.feature.dedicated", "usage.feature.priority", "usage.feature.support247"],
  },
];

export default function UsagePage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-foreground">{t("page.usage")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("page.usage.subtitle")}</p>

      <div className="mt-8 flex flex-col gap-6">
        <UsageMeter />

        <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
          {PLAN_DEFS.map((plan) => (
            <div
              key={plan.nameKey}
              className={`rounded-xl border p-6 ${
                plan.current
                  ? "border-border bg-card"
                  : "border-border bg-card/50"
              }`}
            >
              <p className="text-lg font-bold text-foreground">{t(plan.nameKey)}</p>
              <div className="mt-3 flex items-baseline gap-0.5">
                <span className="text-4xl font-bold text-foreground">{t(plan.priceKey)}</span>
                <span className="text-sm text-muted-foreground">{t("usage.plan.month")}</span>
              </div>

              <ul className="mt-6 space-y-3">
                {plan.featureKeys.map((fk) => (
                  <li key={fk} className="flex items-center gap-2.5 text-sm text-foreground">
                    <Check className="size-4 text-emerald-500 shrink-0" strokeWidth={2.5} />
                    {t(fk)}
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {plan.current ? (
                  <button
                    disabled
                    className="w-full rounded-lg border border-border bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
                  >
                    {t("usage.currentPlan")}
                  </button>
                ) : (
                  <button className="w-full rounded-lg border border-border bg-accent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/80">
                    {t("usage.talkToUs")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
