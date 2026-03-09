// @input: React children, toast configuration (type, message, duration)
// @output: ToastContext with useToast() hook, renders ToastList at bottom-right
// @position: wraps the app tree; single source of truth for all notifications

"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ToastList } from "./toast";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, type?: ToastType, duration?: number) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", duration?: number) => {
      const id = `toast-${++counterRef.current}`;
      const resolvedDuration = duration ?? DEFAULT_DURATION[type];

      setToasts((prev) => {
        const next = [...prev, { id, type, message, duration: resolvedDuration }];
        return next.slice(-MAX_TOASTS);
      });
    },
    []
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastList toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
