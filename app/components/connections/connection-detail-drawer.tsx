// @input: Connection object + open state + callbacks
// @output: right-side sheet with status, permission scopes, timestamps, actions
// @position: overlay on Connections page, triggered by card click

"use client";

import { cn, formatRelativeTime } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, AlertCircle, Loader2, Clock,
  Shield, Zap, Calendar,
} from "lucide-react";
import type { Connection, ConnectionStatus } from "./connection-card";
import { providerIcons, providerColors, providerScopes } from "./provider-config";
import { useT } from "@/lib/i18n";

const STATUS_CLS: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
  available: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20",
  connecting: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  error: "bg-red-500/10 text-red-400 border border-red-500/20",
};

const STATUS_ICONS: Record<ConnectionStatus, React.ReactNode> = {
  connected: <CheckCircle2 className="size-4" />,
  available: <span className="size-2 rounded-full bg-zinc-400" />,
  connecting: <Loader2 className="size-4 animate-spin" />,
  error: <AlertCircle className="size-4" />,
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}


interface ConnectionDetailDrawerProps {
  connection: Connection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
}

export function ConnectionDetailDrawer({
  connection,
  open,
  onOpenChange,
  onConnect,
  onDisconnect,
}: ConnectionDetailDrawerProps) {
  const t = useT();

  if (!connection) return null;

  const Icon = providerIcons[connection.provider];
  const scopes = providerScopes[connection.provider];
  const statusLabel = connection.status === "error" ? t("conn.status.error.label") : t(`conn.badge.${connection.status}` as Parameters<typeof t>[0]);
  const statusDesc = t(`conn.status.${connection.status}.desc` as Parameters<typeof t>[0]);
  const statusCls = STATUS_CLS[connection.status];
  const statusIcon = STATUS_ICONS[connection.status];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-3 pr-6">
            <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", providerColors[connection.provider])}>
              <Icon className="size-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-base">{connection.name}</SheetTitle>
              <SheetDescription className="text-xs mt-0.5 line-clamp-1">
                {connection.description}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          {/* Status block */}
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">{t("conn.drawer.status")}</p>
            <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shrink-0", statusCls)}>
                {statusIcon}
                {statusLabel}
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed pt-0.5">{statusDesc}</p>
            </div>
          </section>

          {/* Timestamps */}
          {(connection.connectedAt ?? connection.lastUsedAt) && (
            <section className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">{t("conn.drawer.time")}</p>
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                {connection.connectedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                      <Calendar className="size-3.5 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground/70">{t("conn.drawer.connectedAt")}</p>
                      <p className="text-xs text-foreground font-medium">
                        {formatDateTime(connection.connectedAt)}
                        <span className="ml-1.5 text-muted-foreground/60 font-normal">
                          ({formatRelativeTime(connection.connectedAt)})
                        </span>
                      </p>
                    </div>
                  </div>
                )}
                {connection.lastUsedAt && (
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                      <Clock className="size-3.5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground/70">{t("conn.drawer.lastUsed")}</p>
                      <p className="text-xs text-foreground font-medium">
                        {formatDateTime(connection.lastUsedAt)}
                        <span className="ml-1.5 text-muted-foreground/60 font-normal">
                          ({formatRelativeTime(connection.lastUsedAt)})
                        </span>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Permission scopes */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">{t("conn.drawer.scope")}</p>
              <Shield className="size-3 text-muted-foreground/40" />
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-2">
                {scopes.map((scope) => (
                  <div key={scope} className="flex items-center gap-2.5">
                    <Zap className="size-3 shrink-0 text-muted-foreground/40" />
                    <span className="text-xs text-muted-foreground">{scope}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/50 leading-relaxed border-t border-border pt-3">
                {t("conn.drawer.scopeNote")}
              </p>
            </div>
          </section>
        </div>

        <SheetFooter className="border-t border-border px-6 py-4">
          {connection.status === "connected" ? (
            <Button
              variant="outline"
              className="w-full text-red-400 border-red-500/20 hover:bg-red-500/5 hover:text-red-400 hover:border-red-500/40"
              onClick={() => { onDisconnect(connection.id); onOpenChange(false); }}
            >
              {t("conn.action.disconnect")}
            </Button>
          ) : connection.status === "error" ? (
            <Button
              className="w-full"
              onClick={() => { onConnect(connection.id); onOpenChange(false); }}
            >
              {t("conn.action.reconnect")}
            </Button>
          ) : connection.status === "available" ? (
            <Button
              className="w-full"
              onClick={() => { onConnect(connection.id); onOpenChange(false); }}
            >
              {t("conn.action.connectName", { name: connection.name })}
            </Button>
          ) : (
            <Button disabled className="w-full">{t("conn.action.connecting")}</Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
