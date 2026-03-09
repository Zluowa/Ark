// @input: list of execution history items
// @output: minimal sidebar list of past executions
// @position: right-side panel on agent page

"use client";

import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export interface HistoryItem {
  id: string;
  toolName: string;
  time: string;
  status: "success" | "error" | "running";
}

const StatusIcon = ({ status }: { status: HistoryItem["status"] }) => {
  if (status === "success") return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  if (status === "error") return <XCircle className="size-3.5 text-red-400" />;
  return <Loader2 className="size-3.5 text-zinc-400 animate-spin" />;
};

interface ExecutionHistoryProps {
  items: HistoryItem[];
}

export function ExecutionHistory({ items }: ExecutionHistoryProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
        History
      </p>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-800/40"
        >
          <StatusIcon status={item.status} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-zinc-300">{item.toolName}</p>
            <p className="text-[10px] text-zinc-600">{item.time}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
