// @input: none (mock data for MVP, replace with real API call)
// @output: recent tool call activity feed with timestamp + status
// @position: bottom section of Home dashboard page

"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useT } from "@/lib/i18n";

type ActivityStatus = "success" | "pending" | "error";

interface ActivityItem {
  id: string;
  tool: string;
  description: string;
  timestamp: string;
  status: ActivityStatus;
}

const MOCK_ACTIVITY: ActivityItem[] = [
  { id: "1", tool: "Web Search", description: "Searched for 'Next.js 15 features'", timestamp: "2m ago", status: "success" },
  { id: "2", tool: "Code Interpreter", description: "Ran Python data analysis script", timestamp: "15m ago", status: "success" },
  { id: "3", tool: "File Reader", description: "Processed document.pdf", timestamp: "1h ago", status: "success" },
  { id: "4", tool: "API Connector", description: "GitHub webhook registration failed", timestamp: "2h ago", status: "error" },
  { id: "5", tool: "Summarizer", description: "Summarized meeting transcript", timestamp: "3h ago", status: "success" },
];

const STATUS_CONFIG: Record<ActivityStatus, { icon: typeof CheckCircle2; color: string }> = {
  success: { icon: CheckCircle2, color: "text-emerald-500" },
  pending: { icon: Clock, color: "text-amber-500" },
  error: { icon: XCircle, color: "text-destructive" },
};

function ActivityRow({ item }: { item: ActivityItem }) {
  const { icon: StatusIcon, color } = STATUS_CONFIG[item.status];
  return (
    <div className="flex items-start gap-3 py-2.5">
      <StatusIcon className={`mt-0.5 size-4 shrink-0 ${color}`} strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{item.tool}</p>
        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground/60">{item.timestamp}</span>
    </div>
  );
}

export function RecentActivity() {
  const t = useT();
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t("activity.title")}</h2>
        <span className="text-xs text-muted-foreground">{t("activity.period")}</span>
      </div>
      <div className="divide-y divide-border">
        {MOCK_ACTIVITY.map((item) => (
          <ActivityRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
