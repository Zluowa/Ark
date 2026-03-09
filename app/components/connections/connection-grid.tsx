// @input: API connection status + filter state
// @output: grouped connection grid with detail drawer + empty state
// @position: main content area of Connections page

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plug } from "lucide-react";
import { ConnectionCard, type Connection } from "./connection-card";
import { useT } from "@/lib/i18n";
import { ConnectionDetailDrawer } from "./connection-detail-drawer";
import { StatusFilter, type ConnectionFilter } from "./status-filter";
import { NeteaseAuthDialog } from "./netease-auth-dialog";
import { XhsAuthDialog } from "./xhs-auth-dialog";
import { ConnectionsSkeleton } from "@/components/skeletons/connections-skeleton";
import { useToast } from "@/components/ui/toast-provider";
import {
  normalizeConnectionProvider,
  toApiConnectionProvider,
  toUiConnectionProvider,
  type UiConnectionProvider,
} from "@/lib/shared/connection-providers";

type ApiConnectionStatus = {
  provider: string;
  status: string;
  updatedAt?: number | string;
  oauthConfigured?: boolean;
};

type StartOAuthResponse = {
  ok?: boolean;
  authorize_url?: string;
  error?: { code?: string; message?: string };
};

export const MOCK_CONNECTIONS: Connection[] = [
  {
    id: "gmail",
    provider: "gmail",
    name: "Gmail",
    description:
      "Send, read, and manage emails directly from your Gmail account.",
    status: "available",
    icon: "Mail",
  },
  {
    id: "google-drive",
    provider: "google-drive",
    name: "Google Drive",
    description: "Upload, download, and organize files in Google Drive.",
    status: "available",
    icon: "HardDrive",
  },
  {
    id: "slack",
    provider: "slack",
    name: "Slack",
    description:
      "Send messages and files to Slack channels and direct messages.",
    status: "available",
    icon: "Hash",
  },
  {
    id: "notion",
    provider: "notion",
    name: "Notion",
    description: "Create pages, add content, and manage your Notion workspace.",
    status: "available",
    icon: "BookOpen",
  },
  {
    id: "feishu",
    provider: "feishu",
    name: "Feishu",
    description:
      "Send messages, create docs, and manage your Feishu workspace.",
    status: "available",
    icon: "MessageCircle",
  },
  {
    id: "dingtalk",
    provider: "dingtalk",
    name: "DingTalk",
    description: "Send notifications and manage tasks in DingTalk.",
    status: "available",
    icon: "Bell",
  },
  {
    id: "wechat-work",
    provider: "wechat-work",
    name: "WeChat Work",
    description: "Send messages and manage workflows in WeChat Work.",
    status: "available",
    icon: "MessageSquare",
  },
  {
    id: "alipay",
    provider: "alipay",
    name: "Alipay",
    description: "Process payments and manage transactions via Alipay.",
    status: "available",
    icon: "CreditCard",
  },
  {
    id: "netease",
    provider: "netease",
    name: "NetEase Cloud Music",
    description:
      "Scan QR to connect your NetEase account and unlock personalized music.",
    status: "available",
    icon: "Disc3",
  },
  {
    id: "xiaohongshu",
    provider: "xiaohongshu",
    name: "Xiaohongshu",
    description:
      "Scan QR code to authorize account and let tools fetch protected resources.",
    status: "available",
    icon: "Camera",
  },
];

const statusFromApi = (status: string): Connection["status"] => {
  if (status === "active") return "connected";
  if (status === "expired") return "error";
  return "available";
};

const toIsoFromTimestamp = (
  value: number | string | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return new Date(parsed).toISOString();
};

function EmptyState({ filter }: { filter: ConnectionFilter }) {
  const t = useT();
  const message =
    filter === "Connected"
      ? t("conn.empty.connected")
      : t("conn.empty.default");

  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50">
        <Plug className="size-7 text-muted-foreground/40" strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {t("conn.empty.title")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function ConnectionGroup({
  title,
  connections,
  onConnect,
  onDisconnect,
  onViewDetail,
}: {
  title: string;
  connections: Connection[];
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onViewDetail: (conn: Connection) => void;
}) {
  if (connections.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {connections.map((conn) => (
          <ConnectionCard
            key={conn.id}
            connection={conn}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onViewDetail={onViewDetail}
          />
        ))}
      </div>
    </div>
  );
}

export function ConnectionGrid() {
  const t = useT();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [connections, setConnections] =
    useState<Connection[]>(MOCK_CONNECTIONS);
  const [filter, setFilter] = useState<ConnectionFilter>("All");
  const [neteaseAuthOpen, setNeteaseAuthOpen] = useState(false);
  const [xhsAuthOpen, setXhsAuthOpen] = useState(false);
  const [detailConnection, setDetailConnection] = useState<Connection | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [oauthReady, setOauthReady] = useState<
    Partial<Record<UiConnectionProvider, boolean>>
  >({});

  const refreshConnections = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/connections");
      const data = (await response.json()) as {
        connections?: ApiConnectionStatus[];
      };
      const rows = data.connections ?? [];

      const nextReady: Partial<Record<UiConnectionProvider, boolean>> = {};
      const indexed = new Map<
        UiConnectionProvider,
        { status: Connection["status"]; connectedAt?: string }
      >();

      for (const row of rows) {
        const apiProvider = normalizeConnectionProvider(
          row.provider.trim().toLowerCase(),
        );
        if (!apiProvider) continue;
        const uiProvider = toUiConnectionProvider(apiProvider);
        nextReady[uiProvider] = row.oauthConfigured !== false;
        const nextStatus = statusFromApi(row.status);
        indexed.set(uiProvider, {
          status: nextStatus,
          connectedAt:
            nextStatus === "connected"
              ? toIsoFromTimestamp(row.updatedAt)
              : undefined,
        });
      }

      setOauthReady(nextReady);
      setConnections((prev) =>
        prev.map((conn) => {
          const mapped = indexed.get(conn.provider);
          if (!mapped)
            return { ...conn, status: "available", connectedAt: undefined };
          return {
            ...conn,
            status: mapped.status,
            connectedAt: mapped.connectedAt,
          };
        }),
      );
    } catch {
      toast("Failed to load connection status.", "error");
    } finally {
      setInitializing(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshConnections();
  }, [refreshConnections]);

  useEffect(() => {
    const oauthStatus = searchParams.get("oauth_status");
    const oauthProviderRaw = searchParams.get("oauth_provider");
    if (!oauthStatus || !oauthProviderRaw) return;

    const apiProvider = normalizeConnectionProvider(
      oauthProviderRaw.trim().toLowerCase(),
    );
    if (apiProvider) {
      const uiProvider = toUiConnectionProvider(apiProvider);
      const success = oauthStatus === "success";
      setConnections((prev) =>
        prev.map((conn) =>
          conn.provider === uiProvider
            ? {
                ...conn,
                status: success ? "connected" : "error",
                connectedAt: success ? new Date().toISOString() : undefined,
              }
            : conn,
        ),
      );
    }

    const oauthError = searchParams.get("oauth_error");
    if (oauthStatus === "success") {
      toast("OAuth authorization succeeded.", "success");
    } else {
      toast(
        oauthError ? `OAuth failed: ${oauthError}` : "OAuth failed.",
        "error",
      );
    }

    if (typeof window !== "undefined") {
      const current = new URL(window.location.href);
      current.searchParams.delete("oauth_status");
      current.searchParams.delete("oauth_provider");
      current.searchParams.delete("oauth_error");
      const query = current.searchParams.toString();
      const next = `${current.pathname}${query ? `?${query}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, [searchParams, toast]);

  const connect = useCallback(
    (id: string) => {
      const target = MOCK_CONNECTIONS.find((c) => c.id === id);
      if (!target) return;

      if (target.provider === "xiaohongshu") {
        setXhsAuthOpen(true);
        return;
      }

      if (target.provider === "netease") {
        setNeteaseAuthOpen(true);
        return;
      }

      if (oauthReady[target.provider] === false) {
        toast(
          `OAuth for ${target.name} is not configured on the server.`,
          "warning",
        );
        return;
      }

      setConnections((prev) =>
        prev.map((conn) =>
          conn.id === id
            ? { ...conn, status: "connecting", connectedAt: undefined }
            : conn,
        ),
      );

      void (async () => {
        try {
          const response = await fetch("/api/v1/connections/oauth/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              provider: toApiConnectionProvider(target.provider),
            }),
          });
          const payload = (await response.json()) as StartOAuthResponse;
          if (!response.ok || typeof payload.authorize_url !== "string") {
            throw new Error(
              payload.error?.message || "Failed to start OAuth flow",
            );
          }
          window.location.href = payload.authorize_url;
        } catch (error) {
          setConnections((prev) =>
            prev.map((conn) =>
              conn.id === id
                ? { ...conn, status: "error", connectedAt: undefined }
                : conn,
            ),
          );
          toast(
            error instanceof Error
              ? error.message
              : "Failed to start OAuth flow",
            "error",
          );
        }
      })();
    },
    [oauthReady, toast],
  );

  const disconnect = useCallback(
    (id: string) => {
      const target = MOCK_CONNECTIONS.find((c) => c.id === id);
      if (!target) return;
      const provider = toApiConnectionProvider(target.provider);
      void fetch(`/api/v1/connections/${provider}`, { method: "DELETE" }).catch(
        () => {
          toast("Failed to disconnect provider.", "error");
        },
      );
      setConnections((prev) =>
        prev.map((conn) =>
          conn.id === id
            ? { ...conn, status: "available", connectedAt: undefined }
            : conn,
        ),
      );
    },
    [toast],
  );

  const onXhsSuccess = useCallback(() => {
    setConnections((prev) =>
      prev.map((conn) =>
        conn.provider === "xiaohongshu"
          ? {
              ...conn,
              status: "connected",
              connectedAt: new Date().toISOString(),
            }
          : conn,
      ),
    );
  }, []);

  const onNeteaseSuccess = useCallback(() => {
    setConnections((prev) =>
      prev.map((conn) =>
        conn.provider === "netease"
          ? {
              ...conn,
              status: "connected",
              connectedAt: new Date().toISOString(),
            }
          : conn,
      ),
    );
  }, []);

  const openDetail = useCallback((conn: Connection) => {
    setDetailConnection(conn);
    setDetailOpen(true);
  }, []);

  const handleDetailConnect = useCallback(
    (id: string) => {
      connect(id);
      setDetailConnection((prev) =>
        prev ? { ...prev, status: "connecting" } : null,
      );
    },
    [connect],
  );

  const handleDetailDisconnect = useCallback(
    (id: string) => {
      disconnect(id);
      setDetailConnection((prev) =>
        prev ? { ...prev, status: "available", connectedAt: undefined } : null,
      );
    },
    [disconnect],
  );

  const connected = useMemo(
    () =>
      connections.filter(
        (conn) =>
          conn.status === "connected" &&
          (filter === "All" || filter === "Connected"),
      ),
    [connections, filter],
  );
  const available = useMemo(
    () =>
      connections.filter(
        (conn) =>
          (conn.status === "available" || conn.status === "error") &&
          (filter === "All" || filter === "Available"),
      ),
    [connections, filter],
  );
  const connecting = useMemo(
    () =>
      connections.filter(
        (conn) => conn.status === "connecting" && filter === "All",
      ),
    [connections, filter],
  );

  const totalVisible = connected.length + available.length + connecting.length;

  if (initializing) return <ConnectionsSkeleton />;

  return (
    <div className="flex flex-col gap-5">
      <StatusFilter active={filter} onChange={setFilter} />

      {totalVisible === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="flex flex-col gap-6">
          <ConnectionGroup
            title={t("conn.group.connected", { count: connected.length })}
            connections={connected}
            onConnect={connect}
            onDisconnect={disconnect}
            onViewDetail={openDetail}
          />
          {connecting.length > 0 && (
            <ConnectionGroup
              title={t("conn.group.connecting")}
              connections={connecting}
              onConnect={connect}
              onDisconnect={disconnect}
              onViewDetail={openDetail}
            />
          )}
          <ConnectionGroup
            title={t("conn.group.available")}
            connections={available}
            onConnect={connect}
            onDisconnect={disconnect}
            onViewDetail={openDetail}
          />
        </div>
      )}

      <XhsAuthDialog
        open={xhsAuthOpen}
        onOpenChange={setXhsAuthOpen}
        onSuccess={onXhsSuccess}
      />

      <NeteaseAuthDialog
        open={neteaseAuthOpen}
        onOpenChange={setNeteaseAuthOpen}
        onSuccess={onNeteaseSuccess}
      />

      <ConnectionDetailDrawer
        connection={detailConnection}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onConnect={handleDetailConnect}
        onDisconnect={handleDetailDisconnect}
      />
    </div>
  );
}
