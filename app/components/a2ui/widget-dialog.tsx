// @input: title, icon, children from DarkShell
// @output: Fullscreen dialog overlay for expanded widget viewing
// @position: Shared expansion layer for all A2UI widgets

"use client";

import { type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import { cn } from "@/lib/utils";

type WidgetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
};

export function WidgetDialog({ open, onOpenChange, title, icon, children }: WidgetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "flex flex-col bg-zinc-900 border border-white/10 rounded-xl shadow-2xl outline-none",
            "w-full h-[100dvh]",
            "sm:w-[calc(100vw-2rem)] sm:h-[calc(100dvh-4rem)] sm:rounded-xl",
            "lg:w-[min(90vw,1200px)] lg:h-[min(90vh,800px)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200",
          )}
        >
          <VisuallyHidden.Root>
            <DialogPrimitive.Title>{title ?? "Widget"}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
          <DialogHeader icon={icon} title={title} onClose={() => onOpenChange(false)} />
          <div className="flex-1 overflow-auto p-4">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

type DialogHeaderProps = {
  icon?: ReactNode;
  title?: string;
  onClose: () => void;
};

function DialogHeader({ icon, title, onClose }: DialogHeaderProps) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-800/80 px-4">
      {icon && <span className="text-zinc-400">{icon}</span>}
      {title && <span className="flex-1 text-sm font-medium text-zinc-100">{title}</span>}
      {!title && <span className="flex-1" />}
      <button
        onClick={onClose}
        aria-label="Close"
        className="rounded p-1 text-zinc-500 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
