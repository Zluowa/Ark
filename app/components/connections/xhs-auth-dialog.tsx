// @input: open state + onSuccess/onClose callbacks
// @output: Dual-mode auth dialog — headed (browser window) or headless (QR image)
// @position: UI component — XHS login flow, auto-detects server mode

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle, RefreshCw, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Phase = "loading" | "browser-open" | "waiting" | "success" | "failed" | "expired";

interface XhsAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function XhsAuthDialog({ open, onOpenChange, onSuccess }: XhsAuthDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [qrImage, setQrImage] = useState("");
  const sessionRef = useRef("");
  const modeRef = useRef<"headed" | "headless">("headed");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/v1/connections/xhs/auth/${sessionRef.current}`);
        if (!r.ok) return;
        const s = await r.json() as { status: string };
        if (s.status === "success") {
          stopPolling();
          setPhase("success");
          setTimeout(() => { onSuccess?.(); onOpenChange(false); }, 1500);
        } else if (s.status === "expired") {
          stopPolling();
          setPhase("expired");
        } else if (s.status === "failed") {
          stopPolling();
          setPhase("failed");
        }
      } catch { /* retry next tick */ }
    }, 2000);
  }, [stopPolling, onSuccess, onOpenChange]);

  const startAuth = useCallback(async () => {
    setPhase("loading");
    setQrImage("");
    stopPolling();
    try {
      const res = await fetch("/api/v1/connections/xhs/auth", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start auth");
      const data = await res.json() as { sessionId: string; mode: string; qrImageBase64?: string };
      sessionRef.current = data.sessionId;
      modeRef.current = data.mode as "headed" | "headless";

      if (data.mode === "headed") {
        setPhase("browser-open");
      } else {
        setQrImage(data.qrImageBase64 ?? "");
        setPhase("waiting");
      }
      startPolling();
    } catch {
      setPhase("failed");
    }
  }, [stopPolling, startPolling]);

  useEffect(() => {
    if (open) { void startAuth(); }
    return stopPolling;
  }, [open, startAuth, stopPolling]);

  const description = modeRef.current === "headed"
    ? "请在弹出的浏览器窗口中扫码登录"
    : "打开小红书App扫描二维码登录";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>连接小红书</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {phase === "loading" && <Loader2 className="size-8 animate-spin text-muted-foreground" />}

          {phase === "browser-open" && <BrowserOpenView />}

          {phase === "waiting" && qrImage && (
            <div className="rounded-xl border border-border bg-white p-3">
              <img src={qrImage} alt="XHS QR Code" className="size-56" />
            </div>
          )}

          {phase === "success" && (
            <>
              <CheckCircle2 className="size-12 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-500">连接成功</p>
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
              <p className="text-sm text-muted-foreground">登录超时（3分钟）</p>
              <RetryButton onClick={() => void startAuth()} />
            </>
          )}

          {phase === "waiting" && (
            <p className="text-center text-sm text-muted-foreground">请用小红书App扫描上方二维码</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BrowserOpenView() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-rose-500/10">
          <ExternalLink className="size-7 text-rose-400" />
        </div>
        <span className="absolute -bottom-1 -right-1 flex size-5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-5 rounded-full bg-emerald-500" />
        </span>
      </div>
      <p className="text-sm font-medium text-foreground">登录窗口已打开</p>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        请在弹出的浏览器窗口中扫码登录小红书
        <br />
        登录成功后窗口会自动关闭
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
