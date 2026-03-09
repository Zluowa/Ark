// @input: Connection object + onConnect/onDisconnect/onViewDetail callbacks
// @output: single connection card with 48px icon, colored badge, capability hint, detail trigger
// @position: grid item inside ConnectionGrid

"use client";

import { cn, formatRelativeTime } from "@/lib/utils";
import { Loader2, AlertCircle, CheckCircle2, Clock, ChevronRight } from "lucide-react";
import { providerIcons, providerColors, providerCapabilities } from "./provider-config";
import { useT } from "@/lib/i18n";
import type { ConnectionProvider } from "./provider-config";

export type { ConnectionProvider };

export type ConnectionStatus = "connected" | "available" | "connecting" | "error";

export interface Connection {
  id: string;
  provider: ConnectionProvider;
  name: string;
  description: string;
  status: ConnectionStatus;
  connectedAt?: string;
  lastUsedAt?: string;
  icon: string;
}

interface ConnectionCardProps {
  connection: Connection;
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onViewDetail?: (connection: Connection) => void;
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const t = useT();
  const styles: Record<ConnectionStatus, { cls: string; label: string; icon: React.ReactNode }> = {
    connected: {
      cls: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
      label: t("conn.badge.connected"),
      icon: <CheckCircle2 className="size-3" />,
    },
    available: {
      cls: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
      label: t("conn.badge.available"),
      icon: <span className="size-1.5 rounded-full bg-zinc-400" />,
    },
    connecting: {
      cls: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
      label: t("conn.badge.connecting"),
      icon: <Loader2 className="size-3 animate-spin" />,
    },
    error: {
      cls: "bg-red-500/10 text-red-400 border border-red-500/20",
      label: t("conn.badge.error"),
      icon: <AlertCircle className="size-3" />,
    },
  };

  const s = styles[status];
  return (
    <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls)}>
      {s.icon}
      {s.label}
    </span>
  );
}

function ActionButton({
  status,
  onConnect,
  onDisconnect,
}: {
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const t = useT();
  if (status === "connected") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400"
      >
        {t("conn.action.disconnect")}
      </button>
    );
  }
  if (status === "connecting") {
    return (
      <button disabled className="rounded-md border border-border/50 px-3 py-1.5 text-xs text-muted-foreground/40 cursor-not-allowed">
        {t("conn.action.connecting")}
      </button>
    );
  }
  if (status === "error") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onConnect(); }}
        className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
      >
        {t("conn.action.reconnect")}
      </button>
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onConnect(); }}
      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {t("conn.action.connect")}
    </button>
  );
}


export function ConnectionCard({ connection, onConnect, onDisconnect, onViewDetail }: ConnectionCardProps) {
  const t = useT();
  const Icon = providerIcons[connection.provider];
  const capability = providerCapabilities[connection.provider];

  const ringClass = {
    connected: "ring-1 ring-emerald-500/20",
    error: "ring-1 ring-red-400/20",
    connecting: "",
    available: "",
  }[connection.status];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onViewDetail?.(connection)}
      onKeyDown={(e) => e.key === "Enter" && onViewDetail?.(connection)}
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-all cursor-pointer",
        "hover:border-border/60 hover:shadow-sm hover:bg-card/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ringClass,
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn("flex size-12 items-center justify-center rounded-xl", providerColors[connection.provider])}>
          <Icon className="size-5" strokeWidth={1.8} />
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={connection.status} />
          <ChevronRight className="size-3.5 text-muted-foreground/30" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{connection.name}</p>
        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
          {connection.description}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="text-[11px] text-muted-foreground/70 mb-0.5">{t("conn.card.capability")}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{capability}</p>
        </div>

        {connection.status === "connected" && connection.connectedAt && (
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <Clock className="size-2.5" />
              {t("conn.card.connectedAt", { time: formatRelativeTime(connection.connectedAt) })}
            </span>
            {connection.lastUsedAt && (
              <span>{t("conn.card.lastUsed", { time: formatRelativeTime(connection.lastUsedAt) })}</span>
            )}
          </div>
        )}

        <ActionButton
          status={connection.status}
          onConnect={() => onConnect?.(connection.id)}
          onDisconnect={() => onDisconnect?.(connection.id)}
        />
      </div>
    </div>
  );
}
