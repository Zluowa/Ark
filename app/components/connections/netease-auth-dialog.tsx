// @input: open state + onSuccess/onClose callbacks
// @output: NetEase QR auth dialog
// @position: UI component - NetEase scan flow backed by local QR session API

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Music4,
  RefreshCw,
  Smartphone,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Phase = "loading" | "waiting" | "confirm" | "success" | "failed" | "expired";

type PollResponse = {
  status: Phase;
  qrImageBase64?: string;
  account?: { nickname?: string };
};

interface NeteaseAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function NeteaseAuthDialog({
  open,
  onOpenChange,
  onSuccess,
}: NeteaseAuthDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrImage, setQrImage] = useState("");
  const [accountName, setAccountName] = useState("");
  const sessionRef = useRef("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/v1/connections/netease/auth/${sessionRef.current}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as PollResponse;
        if (data.qrImageBase64) {
          setQrImage(data.qrImageBase64);
        }
        if (data.account?.nickname) {
          setAccountName(data.account.nickname);
        }

        if (data.status === "waiting" || data.status === "confirm") {
          setPhase(data.status);
          return;
        }

        stopPolling();
        setPhase(data.status);
        if (data.status === "success") {
          setTimeout(() => {
            onSuccess?.();
            onOpenChange(false);
          }, 1500);
        }
      } catch {
        // retry next tick
      }
    }, 2000);
  }, [onOpenChange, onSuccess, stopPolling]);

  const startAuth = useCallback(async () => {
    setPhase("loading");
    setQrImage("");
    setAccountName("");
    stopPolling();
    try {
      const response = await fetch("/api/v1/connections/netease/auth", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to start NetEase auth");
      }
      const data = (await response.json()) as {
        sessionId: string;
        qrImageBase64?: string;
      };
      sessionRef.current = data.sessionId;
      setQrImage(data.qrImageBase64 ?? "");
      setPhase("waiting");
      startPolling();
    } catch {
      setPhase("failed");
    }
  }, [startPolling, stopPolling]);

  useEffect(() => {
    if (open) {
      void startAuth();
    }
    return stopPolling;
  }, [open, startAuth, stopPolling]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>连接网易云音乐</DialogTitle>
          <DialogDescription>
            用网易云音乐 App 扫码登录，本地保存登录态，不上传到云端。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {phase === "loading" && (
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          )}

          {(phase === "waiting" || phase === "confirm") && qrImage && (
            <div className="rounded-2xl border border-border bg-white p-3 shadow-sm">
              <img src={qrImage} alt="NetEase QR Code" className="size-56" />
            </div>
          )}

          {phase === "waiting" && (
            <StatusNote
              icon={<Smartphone className="size-5 text-red-400" />}
              title="等待扫码"
              body="打开网易云音乐 App，扫描上方二维码。"
            />
          )}

          {phase === "confirm" && (
            <StatusNote
              icon={<Music4 className="size-5 text-amber-400" />}
              title="等待确认"
              body="已扫码，请在手机上确认登录。"
            />
          )}

          {phase === "success" && (
            <>
              <CheckCircle2 className="size-12 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-500">
                已连接{accountName ? ` · ${accountName}` : ""}
              </p>
            </>
          )}

          {phase === "failed" && (
            <>
              <XCircle className="size-12 text-red-400" />
              <p className="text-sm text-muted-foreground">连接失败，请重试</p>
              <RetryButton onClick={() => void startAuth()} />
            </>
          )}

          {phase === "expired" && (
            <>
              <XCircle className="size-12 text-amber-400" />
              <p className="text-sm text-muted-foreground">二维码已过期，请重试</p>
              <RetryButton onClick={() => void startAuth()} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusNote({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50">
        {icon}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
    >
      <RefreshCw className="size-3.5" />
      重试
    </button>
  );
}
