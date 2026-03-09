// @input: status + toolName from assistant-ui ToolCallMessagePart
// @output: Shared container for all A2UI widgets (skeleton/error/content)
// @position: Base wrapper — every A2UI widget renders inside this shell

"use client";

import { type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import { cn } from "@/lib/utils";

type Props = {
  status: ToolCallMessagePartStatus;
  toolName: string;
  children: ReactNode;
  className?: string;
};

const statusIcon: Record<string, React.ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
  "requires-action": XCircleIcon,
};

export function WidgetShell({ status, toolName, children, className }: Props) {
  const Icon = statusIcon[status.type] ?? CheckIcon;
  const isRunning = status.type === "running";
  const isError = status.type === "incomplete";

  return (
    <div
      className={cn(
        "my-1 w-full max-w-md overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm",
        isError && "border-destructive/40",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <Icon className={cn("size-3.5 shrink-0", isRunning && "animate-spin")} />
        <span className="truncate">{toolName}</span>
      </div>
      <AnimatePresence mode="wait">
        {isRunning ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-2 p-3"
          >
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="p-3"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
