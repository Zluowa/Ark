import { publicEnv } from "@/lib/config/public-env";

export type RunStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RunSnapshot = {
  apiKeyId?: string;
  runId: string;
  status: RunStatus;
  acceptedAt?: string;
  error?: string;
  source?: string;
  spawnDepth?: number;
  spawnedBy?: string;
  startedAt?: string;
  endedAt?: string;
  tenantId?: string;
};

export type RunEventType =
  | "run.accepted"
  | "run.running"
  | "run.succeeded"
  | "run.failed"
  | "run.cancelled"
  | "run.heartbeat"
  | "run.stream_error";

export type RunEvent = {
  eventId?: number;
  type: RunEventType | string;
  runId?: string;
  status?: RunStatus;
  timestamp?: string;
  error?: string;
  message?: string;
};

export type DispatchMode = "sync" | "async";

export type DispatchMatch = {
  matched: boolean;
  tool?: string;
  confidence?: number;
  threshold?: number;
  reasons?: string[];
};

export type DispatchSyncExecutionSuccess = {
  status: "success";
  run_id: string;
  result: Record<string, unknown>;
  duration_ms?: number;
  credits_used?: number;
};

export type DispatchSyncExecutionFailure = {
  status: "failed";
  run_id: string;
  error: {
    code?: string;
    message?: string;
  };
};

export type DispatchAsyncExecution = {
  job_id: string;
  run_id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  estimated_duration_ms?: number;
};

export type DispatchFastResponse = {
  ok: true;
  channel: "fast";
  mode: DispatchMode;
  match: DispatchMatch;
  execution:
    | DispatchSyncExecutionSuccess
    | DispatchSyncExecutionFailure
    | DispatchAsyncExecution;
  suggestions?: string[];
};

export type DispatchFallbackResponse = {
  ok: true;
  channel: "fallback";
  match: DispatchMatch;
  suggestions?: string[];
  hint?: string;
};

export type DispatchResponse = DispatchFastResponse | DispatchFallbackResponse;

export type DispatchRequest = {
  mode?: DispatchMode;
  params?: Record<string, unknown>;
  prompt: string;
  threshold?: number;
  tool?: string;
};

type RawRunStatus = RunStatus;

type RawRunPayload = {
  apiKeyId?: string;
  id: string;
  status: RawRunStatus;
  acceptedAt?: number | string;
  error?: string;
  source?: string;
  spawnDepth?: number;
  spawnedBy?: string;
  startedAt?: number | string;
  endedAt?: number | string;
  tenantId?: string;
};

type RawRunResponse = {
  ok: boolean;
  run: RawRunPayload;
};

const withControlPlaneBase = (path: string): string => {
  const base = publicEnv.controlPlaneBaseUrl?.replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
};

const withApiKeyHeader = (headers?: HeadersInit): Headers => {
  const merged = new Headers(headers);
  const apiKey = publicEnv.apiKey?.trim();
  if (apiKey) {
    merged.set("x-api-key", apiKey);
  }
  return merged;
};

const toIso = (value: number | string | undefined): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return undefined;
};

const toSnapshot = (run: RawRunPayload): RunSnapshot => {
  return {
    apiKeyId: run.apiKeyId,
    runId: run.id,
    status: run.status,
    acceptedAt: toIso(run.acceptedAt),
    error: run.error,
    source: run.source,
    spawnDepth:
      typeof run.spawnDepth === "number" && Number.isFinite(run.spawnDepth)
        ? Math.max(0, Math.floor(run.spawnDepth))
        : undefined,
    spawnedBy: run.spawnedBy,
    startedAt: toIso(run.startedAt),
    endedAt: toIso(run.endedAt),
    tenantId: run.tenantId,
  };
};

const toOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const ensureOk = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let details = "";
    try {
      const body = (await res.json()) as {
        error?: { message?: string };
        message?: string;
      };
      details = body.error?.message ?? body.message ?? "";
    } catch {
      details = "";
    }
    throw new Error(
      details
        ? `Control plane request failed (${res.status}): ${details}`
        : `Control plane request failed (${res.status})`,
    );
  }

  return (await res.json()) as T;
};

export const getRun = async (runId: string): Promise<RunSnapshot> => {
  const res = await fetch(withControlPlaneBase(`/api/runs/${runId}`), {
    method: "GET",
    cache: "no-store",
    headers: withApiKeyHeader(),
  });

  const data = await ensureOk<RawRunResponse>(res);
  return toSnapshot(data.run);
};

export const waitRun = async (
  runId: string,
  timeoutMs = 15000,
): Promise<RunSnapshot> => {
  const res = await fetch(
    withControlPlaneBase(`/api/runs/${runId}/wait?timeoutMs=${timeoutMs}`),
    {
      method: "GET",
      cache: "no-store",
      headers: withApiKeyHeader(),
    },
  );

  const data = await ensureOk<RawRunResponse>(res);
  return toSnapshot(data.run);
};

export const cancelRun = async (runId: string): Promise<RunSnapshot> => {
  const res = await fetch(withControlPlaneBase(`/api/runs/${runId}/cancel`), {
    method: "POST",
    cache: "no-store",
    headers: withApiKeyHeader(),
  });

  const data = await ensureOk<RawRunResponse>(res);
  return toSnapshot(data.run);
};

export const dispatchPrompt = async (
  request: DispatchRequest,
): Promise<DispatchResponse> => {
  const res = await fetch(withControlPlaneBase("/api/v1/dispatch"), {
    method: "POST",
    headers: withApiKeyHeader({ "content-type": "application/json" }),
    body: JSON.stringify({
      prompt: request.prompt,
      tool: request.tool,
      params: request.params,
      mode: request.mode ?? "sync",
      threshold: request.threshold,
    }),
  });

  return await ensureOk<DispatchResponse>(res);
};

type SubscribeHandlers = {
  onOpen?: () => void;
  onError?: () => void;
  onEvent: (event: RunEvent) => void;
};

const RUN_EVENT_NAMES: readonly RunEventType[] = [
  "run.accepted",
  "run.running",
  "run.succeeded",
  "run.failed",
  "run.cancelled",
  "run.heartbeat",
  "run.stream_error",
];

const parseRunEvent = (
  type: string,
  message: MessageEvent<string>,
): RunEvent => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(message.data) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const rawId = message.lastEventId?.trim();
  const parsedId = rawId ? Number(rawId) : undefined;
  const eventId =
    typeof parsedId === "number" && Number.isFinite(parsedId)
      ? parsedId
      : undefined;

  return {
    eventId,
    type,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    status:
      payload.status === "accepted" ||
      payload.status === "running" ||
      payload.status === "succeeded" ||
      payload.status === "failed" ||
      payload.status === "cancelled"
        ? payload.status
        : undefined,
    timestamp: toIso(
      toOptionalNumber(payload.timestamp) ??
        (typeof payload.timestamp === "string" ? payload.timestamp : undefined),
    ),
    error: typeof payload.error === "string" ? payload.error : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
  };
};

export const subscribeRunEvents = (
  runId: string,
  handlers: SubscribeHandlers,
): (() => void) => {
  if (
    typeof window === "undefined" ||
    typeof window.EventSource === "undefined"
  ) {
    return () => {};
  }

  const eventPath = (() => {
    const path = `/api/runs/${runId}/events`;
    const apiKey = publicEnv.apiKey?.trim();
    if (!apiKey) {
      return path;
    }
    const encoded = encodeURIComponent(apiKey);
    return `${path}?api_key=${encoded}`;
  })();

  const source = new EventSource(withControlPlaneBase(eventPath));

  const listenerRefs: Array<{
    eventName: RunEventType;
    listener: (event: Event) => void;
  }> = [];

  source.onopen = () => {
    handlers.onOpen?.();
  };

  source.onerror = () => {
    handlers.onError?.();
  };

  for (const eventName of RUN_EVENT_NAMES) {
    const listener = (event: Event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }
      handlers.onEvent(parseRunEvent(eventName, event as MessageEvent<string>));
    };
    source.addEventListener(eventName, listener);
    listenerRefs.push({ eventName, listener });
  }

  return () => {
    for (const entry of listenerRefs) {
      source.removeEventListener(entry.eventName, entry.listener);
    }
    source.close();
  };
};
