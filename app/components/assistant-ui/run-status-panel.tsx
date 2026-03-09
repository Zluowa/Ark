"use client";

import Link from "next/link";
import { useComposerRuntime } from "@assistant-ui/react";
import { useThread } from "@assistant-ui/react";
import { AlertTriangleIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { type FC, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRunStatus } from "@/hooks/use-run-status";
import { cancelRun, waitRun, type RunStatus } from "@/lib/api/control-plane";

const STATUS_STYLES: Record<RunStatus, string> = {
  accepted: "border-amber-300 bg-amber-100 text-amber-900",
  running: "border-blue-300 bg-blue-100 text-blue-900",
  succeeded: "border-emerald-300 bg-emerald-100 text-emerald-900",
  failed: "border-rose-300 bg-rose-100 text-rose-900",
  cancelled: "border-zinc-300 bg-zinc-200 text-zinc-900",
};

const TERMINAL_STATUS = new Set<RunStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

const STATUS_LABELS: Record<RunStatus, string> = {
  accepted: "Accepted",
  running: "Running",
  succeeded: "Completed",
  failed: "Needs Attention",
  cancelled: "Cancelled",
};

const EVENT_LABELS: Record<string, string> = {
  "run.accepted": "Request accepted",
  "run.running": "Task started",
  "run.succeeded": "Task completed",
  "run.failed": "Task failed",
  "run.cancelled": "Task cancelled",
};

const CONNECTION_STYLES: Record<
  "idle" | "connecting" | "live" | "reconnecting" | "offline",
  string
> = {
  idle: "border-zinc-300 bg-zinc-100 text-zinc-700",
  connecting: "border-amber-300 bg-amber-100 text-amber-900",
  live: "border-emerald-300 bg-emerald-100 text-emerald-900",
  reconnecting: "border-orange-300 bg-orange-100 text-orange-900",
  offline: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

const formatTimestamp = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toLocaleString();
};

const formatDuration = (
  startedAt?: string,
  endedAt?: string,
): string | undefined => {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return undefined;
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  if (Number.isNaN(end)) return undefined;
  return `${Math.max(0, end - start)}ms`;
};

const extractLatestRunId = (
  messages: ReadonlyArray<{
    metadata: { custom: Record<string, unknown> };
  }>,
): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const value = messages[i]?.metadata?.custom?.runId;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const extractLatestUserPrompt = (
  messages: ReadonlyArray<{
    role?: string;
    content?: ReadonlyArray<{ type?: string; text?: string }>;
  }>,
): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }
    const textPart = message.content.find(
      (part) => part?.type === "text" && typeof part.text === "string",
    );
    const text = textPart?.text?.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
};

const buildRecoveryGuidance = (errorText: string | undefined): string[] => {
  if (!errorText?.trim()) {
    return [
      "Retry with a clearer one-sentence request.",
      "Open Tools workbench to adjust parameters before rerun.",
    ];
  }
  const normalized = errorText.toLowerCase();
  if (
    normalized.includes("required") ||
    normalized.includes("missing") ||
    normalized.includes("validation")
  ) {
    return [
      "Check required parameters and file URLs.",
      "Retry after completing missing fields.",
    ];
  }
  if (normalized.includes("timeout")) {
    return [
      "Try a smaller input file or shorter clip.",
      "Rerun in Tools with tighter settings.",
    ];
  }
  return [
    "Retry with a shorter and more specific request.",
    "Switch to Tools workbench for manual parameter control.",
  ];
};

export const RunStatusPanel: FC = () => {
  const composerRuntime = useComposerRuntime();
  const runId = useThread((state) =>
    extractLatestRunId(
      state.messages as ReadonlyArray<{
        metadata: { custom: Record<string, unknown> };
      }>,
    ),
  );
  const latestUserPrompt = useThread((state) =>
    extractLatestUserPrompt(
      state.messages as ReadonlyArray<{
        role?: string;
        content?: ReadonlyArray<{ type?: string; text?: string }>;
      }>,
    ),
  );
  const { run, loading, error, connection, events, refresh } = useRunStatus(
    runId,
    1200,
  );

  const [action, setAction] = useState<"wait" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const status = run?.status ?? (runId ? "accepted" : undefined);
  const statusStyle = status ? STATUS_STYLES[status] : STATUS_STYLES.accepted;
  const duration = useMemo(
    () => formatDuration(run?.startedAt ?? run?.acceptedAt, run?.endedAt),
    [run?.acceptedAt, run?.endedAt, run?.startedAt],
  );
  const isTerminal = status ? TERMINAL_STATUS.has(status) : false;
  const statusLabel = status ? STATUS_LABELS[status] : "Idle";
  const runError = run?.error ?? error ?? actionError;
  const recoveryGuidance = useMemo(
    () => buildRecoveryGuidance(runError),
    [runError],
  );
  const needsRecovery =
    status === "failed" || status === "cancelled" || Boolean(runError);

  const onWait = async () => {
    if (!runId) return;
    setAction("wait");
    setActionError(undefined);
    try {
      await waitRun(runId, 15000);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "wait failed");
    } finally {
      setAction(null);
    }
  };

  const onCancel = async () => {
    if (!runId) return;
    setAction("cancel");
    setActionError(undefined);
    try {
      await cancelRun(runId);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "cancel failed");
    } finally {
      setAction(null);
    }
  };

  const onLoadLastPrompt = () => {
    if (!latestUserPrompt?.trim()) return;
    composerRuntime.setText(latestUserPrompt.trim());
  };

  return (
    <section className="rounded-2xl border bg-card/80 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-muted-foreground uppercase tracking-wide">
            Current Task
          </p>
          <p className="truncate font-mono text-[11px] text-foreground">
            {runId ?? "No run yet. Send a message first."}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 font-medium ${statusStyle}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-2">
        <span
          className={`rounded-full border px-2 py-1 font-medium text-[11px] ${CONNECTION_STYLES[connection]}`}
        >
          Live updates: {connection}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1 text-muted-foreground md:grid-cols-2">
        <div>
          accepted:{" "}
          <span className="text-foreground">
            {formatTimestamp(run?.acceptedAt) ?? "-"}
          </span>
        </div>
        <div>
          started:{" "}
          <span className="text-foreground">
            {formatTimestamp(run?.startedAt) ?? "-"}
          </span>
        </div>
        <div>
          ended:{" "}
          <span className="text-foreground">
            {formatTimestamp(run?.endedAt) ?? "-"}
          </span>
        </div>
        <div>
          duration: <span className="text-foreground">{duration ?? "-"}</span>
        </div>
      </div>

      {runError && (
        <p className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900">
          {runError}
        </p>
      )}

      {needsRecovery ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2">
          <p className="flex items-center gap-1 font-medium text-amber-900 text-xs">
            <AlertTriangleIcon className="size-3.5" />
            Recovery Guide
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-amber-900">
            {recoveryGuidance.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onLoadLastPrompt}
              disabled={!latestUserPrompt?.trim()}
            >
              Load Last Prompt
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href="/tools">Open Tools</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 rounded-md border bg-muted/30 p-2">
        <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Timeline
        </p>
        <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No run events yet.
            </p>
          ) : (
            [...events].reverse().map((event, index) => {
              const key =
                typeof event.eventId === "number"
                  ? `evt-${event.eventId}`
                  : `evt-${event.type}-${event.timestamp ?? index}`;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 font-mono text-[11px]"
                >
                  <span className="truncate text-foreground">
                    {EVENT_LABELS[event.type] ?? event.type}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatTimestamp(event.timestamp) ?? "-"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void refresh();
          }}
          disabled={!runId || loading || action !== null}
        >
          <RefreshCwIcon className="size-3.5" />
          Refresh
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void onWait();
          }}
          disabled={!runId || isTerminal || action !== null}
        >
          {action === "wait" ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : null}
          Wait
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => {
            void onCancel();
          }}
          disabled={!runId || isTerminal || action !== null}
        >
          {action === "cancel" ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : null}
          Cancel
        </Button>
      </div>
    </section>
  );
};
