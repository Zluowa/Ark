// @input: toolCount prop from parent server component
// @output: horizontal row of 3 stat cards for Home dashboard
// @position: between WelcomeHero and QuickActions on Home page

"use client";

import { Wrench, Plug, Activity } from "lucide-react";
import { StatCard } from "./stat-card";
import { useT } from "@/lib/i18n";

export function StatsRow({ toolCount }: { toolCount: number }) {
  const t = useT();
  const stats = [
    { label: t("stats.tools"), value: String(toolCount), subtitle: t("stats.tools.sub"), icon: Wrench, iconColor: "text-emerald-500" },
    { label: t("stats.conns"), value: "0", subtitle: t("stats.conns.sub"), icon: Plug, iconColor: "text-blue-500" },
    { label: t("stats.calls"), value: "—", subtitle: t("stats.calls.sub"), icon: Activity, iconColor: "text-violet-500" },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}
