// @input: label, value, subtitle, icon, trend props
// @output: enhanced stat card with icon, value, trend indicator
// @position: building block for StatsRow on Home page

import { type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  label: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  iconColor?: string;
  loading?: boolean;
}

export function StatCard({ label, value, subtitle, icon: Icon, iconColor = "text-muted-foreground", loading }: StatCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-3 w-16 mb-3" />
        <Skeleton className="h-7 w-12 mb-1" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }

  return (
    <div className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-border/80 hover:bg-card/80">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className={`rounded-lg p-1.5 bg-muted/50 ${iconColor}`}>
          <Icon className="size-3.5" strokeWidth={1.8} />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
