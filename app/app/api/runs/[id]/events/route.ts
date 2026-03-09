import { runRegistry, type RunEvent } from "@/lib/server/run-registry";
import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { withObservedRequest } from "@/lib/server/observability";

type ParamsContext = {
  params: Promise<unknown>;
};

const encoder = new TextEncoder();
const HEARTBEAT_MS = 15000;
const POLL_INTERVAL_MS = 300;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const parseAfterEventId = (req: Request): number => {
  const url = new URL(req.url);
  const queryValue = url.searchParams.get("afterEventId");
  const headerValue = req.headers.get("last-event-id");
  const raw = queryValue ?? headerValue;
  if (!raw) return 0;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const toSseEventChunk = (
  event: string,
  data: Record<string, unknown>,
  id?: number,
): Uint8Array => {
  let payload = "";
  if (typeof id === "number") {
    payload += `id: ${id}\n`;
  }
  payload += `event: ${event}\n`;
  const json = JSON.stringify(data);
  for (const line of json.split("\n")) {
    payload += `data: ${line}\n`;
  }
  payload += "\n";
  return encoder.encode(payload);
};

const isTerminal = (event: RunEvent): boolean => TERMINAL.has(event.status);

export async function GET(req: Request, context: ParamsContext) {
  return withObservedRequest(req, {
    route: "/api/runs/:id/events",
    handler: async (observation) => {
      const access = authorizeRequest(req, "runs:read");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const { id } = (await context.params) as { id?: string };
      if (!id) {
        return Response.json(
          {
            error: {
              code: "bad_request",
              message: "Missing run id",
            },
          },
          { status: 400 },
        );
      }

      const run = await runRegistry.get(id);
      if (!run) {
        return Response.json(
          {
            error: {
              code: "not_found",
              message: `Run not found: ${id}`,
            },
          },
          { status: 404 },
        );
      }
      if (!canAccessTenant(access.identity, run.tenantId)) {
        return tenantBlockedResponse("Run", id);
      }

      const afterEventId = parseAfterEventId(req);
      const replayEvents =
        (await runRegistry.getEventsSince(id, afterEventId)) ?? [];

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false;
          let lastEventId = afterEventId;
          let lastHeartbeatAt = Date.now();

          const close = () => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              // Ignore close errors after aborts.
            }
          };

          const send = (chunk: Uint8Array) => {
            if (closed) return;
            try {
              controller.enqueue(chunk);
            } catch {
              close();
            }
          };

          const sendRunEvent = (event: RunEvent) => {
            send(
              toSseEventChunk(
                event.type,
                {
                  runId: event.runId,
                  status: event.status,
                  timestamp: event.timestamp,
                  error: event.error,
                },
                event.eventId,
              ),
            );
          };

          for (const event of replayEvents) {
            lastEventId = Math.max(lastEventId, event.eventId);
            sendRunEvent(event);
          }

          const lastReplay = replayEvents.at(-1);
          if (lastReplay && isTerminal(lastReplay)) {
            close();
            return;
          }

          const snapshot = await runRegistry.get(id);
          if (
            snapshot &&
            TERMINAL.has(snapshot.status) &&
            replayEvents.length === 0
          ) {
            close();
            return;
          }

          while (!closed) {
            if (req.signal.aborted) {
              close();
              return;
            }

            const events =
              (await runRegistry.getEventsSince(id, lastEventId)) ?? [];
            for (const event of events) {
              lastEventId = Math.max(lastEventId, event.eventId);
              sendRunEvent(event);

              if (isTerminal(event)) {
                close();
                return;
              }
            }

            const latest = await runRegistry.get(id);
            if (!latest) {
              close();
              return;
            }

            if (TERMINAL.has(latest.status)) {
              close();
              return;
            }

            const now = Date.now();
            if (now - lastHeartbeatAt >= HEARTBEAT_MS) {
              send(
                toSseEventChunk("run.heartbeat", {
                  runId: id,
                  timestamp: now,
                }),
              );
              lastHeartbeatAt = now;
            }

            await sleep(POLL_INTERVAL_MS);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
  });
}
