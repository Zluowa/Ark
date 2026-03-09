// @input: Toast[] from ToastProvider, onDismiss callback
// @output: animated toast cards anchored to bottom-right with progress bars
// @position: purely visual layer; no state ownership, driven by toast-provider

"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Toast, ToastType } from "./toast-provider";

// ── visual config ───────────────────────────────────────────────────────────

const TOAST_CONFIG: Record<
  ToastType,
  { icon: React.ElementType; border: string; icon_color: string; progress: string }
> = {
  success: {
    icon: CheckCircle,
    border: "border-emerald-500/30",
    icon_color: "text-emerald-400",
    progress: "bg-emerald-500",
  },
  error: {
    icon: XCircle,
    border: "border-red-500/30",
    icon_color: "text-red-400",
    progress: "bg-red-500",
  },
  info: {
    icon: Info,
    border: "border-blue-500/30",
    icon_color: "text-blue-400",
    progress: "bg-blue-500",
  },
  warning: {
    icon: AlertTriangle,
    border: "border-amber-500/30",
    icon_color: "text-amber-400",
    progress: "bg-amber-500",
  },
};

// ── single toast card ────────────────────────────────────────────────────────

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { icon: Icon, border, icon_color, progress } = TOAST_CONFIG[toast.type];
  const [width, setWidth] = useState(100);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const elapsed = now - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / toast.duration) * 100);
      setWidth(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onDismiss(toast.id);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn(
        "relative w-80 overflow-hidden rounded-xl border bg-zinc-900/95 shadow-2xl backdrop-blur-sm",
        border
      )}
    >
      {/* content row */}
      <div className="flex items-start gap-3 p-4">
        <Icon className={cn("mt-0.5 size-4 shrink-0", icon_color)} />
        <p className="flex-1 text-sm leading-snug text-zinc-100">{toast.message}</p>
        <button
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 rounded-md p-0.5 text-zinc-500 transition-colors hover:bg-white/8 hover:text-zinc-300"
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* progress bar */}
      <div className="h-0.5 w-full bg-white/5">
        <div
          className={cn("h-full transition-none", progress)}
          style={{ width: `${width}%` }}
        />
      </div>
    </motion.div>
  );
}

// ── toast list (portal anchor) ───────────────────────────────────────────────

export function ToastList({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3"
    >
      <AnimatePresence mode="sync">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastCard toast={t} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
