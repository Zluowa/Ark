"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getRun,
  subscribeRunEvents,
  type RunEvent,
  type RunSnapshot,
} from "@/lib/api/control-plane";

type RunConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline";

type UseRunStatusResult = {
  run?: RunSnapshot;
  loading: boolean;
  error?: string;
  connection: RunConnectionState;
  events: RunEvent[];
  refresh: () => Promise<RunSnapshot | undefined>;
};

const TERMINAL: Set<RunSnapshot["status"]> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export const useRunStatus = (
  runId: string | undefined,
  pollMs = 1000,
): UseRunStatusResult => {
  const [run, setRun] = useState<RunSnapshot | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(Boolean(runId));
  const [error, setError] = useState<string | undefined>(undefined);
  const [connection, setConnection] = useState<RunConnectionState>("idle");
  const [events, setEvents] = useState<RunEvent[]>([]);

  const refresh = useCallback(async (): Promise<RunSnapshot | undefined> => {
    if (!runId) {
      setRun(undefined);
      setLoading(false);
      setError(undefined);
      return undefined;
    }

    const snapshot = await getRun(runId);
    setRun(snapshot);
    setLoading(false);
    setError(undefined);
    return snapshot;
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setRun(undefined);
      setLoading(false);
      setError(undefined);
      setConnection("idle");
      setEvents([]);
      return;
    }

    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};

    const tick = async () => {
      try {
        const snapshot = await refresh();
        if (!mounted) {
          return;
        }

        if (snapshot && !TERMINAL.has(snapshot.status)) {
          timer = setTimeout(tick, pollMs);
        }
      } catch (err) {
        if (!mounted) {
          return;
        }

        setLoading(false);
        setError(
          err instanceof Error ? err.message : "Unknown run status error",
        );
        timer = setTimeout(tick, pollMs);
      }
    };

    const pushEvent = (event: RunEvent) => {
      if (event.type === "run.heartbeat") {
        return;
      }

      setEvents((previous) => {
        if (
          typeof event.eventId === "number" &&
          previous.some((item) => item.eventId === event.eventId)
        ) {
          return previous;
        }
        const next = [...previous, event];
        return next.slice(-40);
      });
    };

    setEvents([]);
    setLoading(true);
    setConnection(
      typeof window !== "undefined" && typeof window.EventSource !== "undefined"
        ? "connecting"
        : "offline",
    );
    tick();

    unsubscribe = subscribeRunEvents(runId, {
      onOpen: () => {
        if (!mounted) return;
        setConnection("live");
      },
      onError: () => {
        if (!mounted) return;
        setConnection((current) =>
          current === "live" || current === "connecting"
            ? "reconnecting"
            : "offline",
        );
      },
      onEvent: (event) => {
        if (!mounted) return;
        pushEvent(event);

        if (event.type === "run.stream_error") {
          setError(event.message ?? "Run event stream unavailable.");
          return;
        }

        if (event.type !== "run.heartbeat") {
          void refresh().catch((err) => {
            if (!mounted) return;
            setError(
              err instanceof Error
                ? err.message
                : "Unknown run status refresh error",
            );
          });
        }
      },
    });

    return () => {
      mounted = false;
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe();
    };
  }, [runId, pollMs, refresh]);

  return { run, loading, error, connection, events, refresh };
};
