// @input: none (static links to primary destinations)
// @output: 2x3 grid of quick-entry cards with icon, title, description
// @position: middle section of Home dashboard, below StatsRow

"use client";

import Link from "next/link";
import { Zap, Wrench, Plug, BarChart3, Settings, Globe } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";

interface ActionCardProps {
  label: string;
  description: string;
  href: string;
  icon: typeof Zap;
  iconColor: string;
  external?: boolean;
}

const ACTION_DEFS: { labelKey: MessageKey; descKey: MessageKey; href: string; icon: typeof Zap; iconColor: string; external?: boolean }[] = [
  { labelKey: "actions.agent", descKey: "actions.agent.desc", href: "/dashboard/agent", icon: Zap, iconColor: "bg-emerald-500/10 text-emerald-500" },
  { labelKey: "actions.tools", descKey: "actions.tools.desc", href: "/dashboard/tools", icon: Wrench, iconColor: "bg-blue-500/10 text-blue-500" },
  { labelKey: "actions.connections", descKey: "actions.connections.desc", href: "/dashboard/connections", icon: Plug, iconColor: "bg-violet-500/10 text-violet-500" },
  { labelKey: "actions.usage", descKey: "actions.usage.desc", href: "/dashboard/usage", icon: BarChart3, iconColor: "bg-amber-500/10 text-amber-500" },
  { labelKey: "actions.settings", descKey: "actions.settings.desc", href: "/dashboard/settings", icon: Settings, iconColor: "bg-muted text-muted-foreground" },
  { labelKey: "actions.docs", descKey: "actions.docs.desc", href: "https://docs.omniagent.dev", icon: Globe, iconColor: "bg-muted text-muted-foreground", external: true },
];

function ActionCard({ label, description, href, icon: Icon, iconColor, external }: ActionCardProps) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card/50 p-4 transition-all hover:border-border hover:bg-card hover:shadow-sm"
    >
      <div className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${iconColor}`}>
        <Icon className="size-4" strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground group-hover:text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </Link>
  );
}

export function QuickActions() {
  const t = useT();
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-foreground">{t("actions.title")}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ACTION_DEFS.map((a) => (
          <ActionCard key={a.labelKey} label={t(a.labelKey)} description={t(a.descKey)} href={a.href} icon={a.icon} iconColor={a.iconColor} external={a.external} />
        ))}
      </div>
    </div>
  );
}
