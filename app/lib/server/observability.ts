import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/server/env";

type ApiRequestClass = "success" | "user_error" | "server_error";
type AlertCode =
  | "api_success_rate_low"
  | "run_terminal_coverage_low"
  | "wait_p95_high"
  | "idempotency_reuse_low";
type AlertSeverity = "warning" | "critical";
type AlertOwner = "api-oncall" | "runtime-oncall" | "platform-oncall";

type ApiSample = {
  apiKeyId?: string;
  classification: ApiRequestClass;
  durationMs: number;
  idempotencyRequested: boolean;
  idempotencyReused: boolean;
  method: string;
  requestId: string;
  route: string;
  status: number;
  tenantId?: string;
  timestamp: number;
};

type WaitLatencySample = {
  latencyMs: number;
  timestamp: number;
};

type IdempotencySample = {
  reused: boolean;
  timestamp: number;
};

export type ObservabilityAlert = {
  code: AlertCode;
  message: string;
  owner: AlertOwner;
  severity: AlertSeverity;
  target: number;
  timestamp: number;
  value: number;
};

type AlertSnapshot = Omit<ObservabilityAlert, "timestamp">;

export type SloSnapshot = {
  alerts: Omit<ObservabilityAlert, "timestamp">[];
  api: {
    nonUserSuccessRate: number;
    pass: boolean;
    requests: number;
    serverErrors: number;
    success: number;
    target: number;
    userErrors: number;
  };
  generatedAt: number;
  idempotency: {
    pass: boolean;
    requestsWithKey: number;
    reuseRate: number;
    reused: number;
    target: number;
  };
  runTerminalCoverage: {
    coverageRate: number;
    observedTerminalRuns: number;
    pass: boolean;
    terminalRunsWithEvents: number;
    target: number;
  };
  waitAfterTerminal: {
    p95Ms: number;
    pass: boolean;
    samples: number;
    targetMs: number;
  };
  windowMs: number;
};

export type RouteObservationContext = {
  requestId: string;
  setIdentity: (identity: { apiKeyId?: string; tenantId?: string }) => void;
};

type ObserveRouteOptions = {
  handler: (context: RouteObservationContext) => Promise<Response>;
  route: string;
};

const WINDOW_MS = 24 * 60 * 60 * 1000;
const ALERT_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const TERMINAL_STATUS = new Set(["succeeded", "failed", "cancelled"]);
const WAIT_TARGET_MS = 2000;
const WAIT_CRITICAL_MS = 5000;
const API_SUCCESS_TARGET = 0.995;
const RUN_COVERAGE_TARGET = 0.99;
const IDEMPOTENCY_REUSE_TARGET = 0.98;

const apiSamples: ApiSample[] = [];
const waitSamples: WaitLatencySample[] = [];
const idempotencySamples: IdempotencySample[] = [];
const observedTerminalRuns = new Map<string, number>();
const terminalRunsWithEvents = new Map<string, number>();
const alertHistory: ObservabilityAlert[] = [];
const lastAlertEmitAt = new Map<string, number>();
const activeAlertStates = new Map<AlertCode, AlertSeverity>();

const classifyStatus = (status: number): ApiRequestClass => {
  if (status >= 500) {
    return "server_error";
  }
  if (status >= 400) {
    return "user_error";
  }
  return "success";
};

const safeNumber = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
};

const percentile = (values: readonly number[], p: number): number => {
  if (values.length < 1) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index] ?? 0;
};

const logStructured = (
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>,
): void => {
  const payload = JSON.stringify({
    event,
    level,
    ts: new Date().toISOString(),
    ...fields,
  });
  if (level === "error") {
    console.error(payload);
    return;
  }
  if (level === "warn") {
    console.warn(payload);
    return;
  }
  console.log(payload);
};

const normalizeMethod = (method: string): string =>
  method.trim().toUpperCase() || "GET";

const normalizeRoute = (route: string): string => route.trim() || "unknown";

const appendRequestIdHeader = (
  response: Response,
  requestId: string,
): Response => {
  if (response.headers.get("x-request-id")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const capArray = <T>(items: T[], max: number): void => {
  const extra = items.length - Math.max(1, Math.floor(max));
  if (extra > 0) {
    items.splice(0, extra);
  }
};

const pruneOldWindowData = (): void => {
  const now = Date.now();
  const threshold = now - WINDOW_MS;

  while (apiSamples.length > 0 && apiSamples[0].timestamp < threshold) {
    apiSamples.shift();
  }
  while (waitSamples.length > 0 && waitSamples[0].timestamp < threshold) {
    waitSamples.shift();
  }
  while (
    idempotencySamples.length > 0 &&
    idempotencySamples[0].timestamp < threshold
  ) {
    idempotencySamples.shift();
  }

  for (const [runId, timestamp] of observedTerminalRuns.entries()) {
    if (timestamp < threshold) {
      observedTerminalRuns.delete(runId);
    }
  }
  for (const [runId, timestamp] of terminalRunsWithEvents.entries()) {
    if (timestamp < threshold) {
      terminalRunsWithEvents.delete(runId);
    }
  }
};

const evaluateAlerts = (snapshot: SloSnapshot): AlertSnapshot[] => {
  const alerts: AlertSnapshot[] = [];

  if (snapshot.api.nonUserSuccessRate < snapshot.api.target) {
    alerts.push({
      code: "api_success_rate_low",
      message: "API non-user-error success rate dropped below SLO target.",
      owner: "api-oncall",
      severity: "critical",
      target: snapshot.api.target,
      value: snapshot.api.nonUserSuccessRate,
    });
  }

  if (
    snapshot.runTerminalCoverage.observedTerminalRuns >= 10 &&
    snapshot.runTerminalCoverage.coverageRate <
      snapshot.runTerminalCoverage.target
  ) {
    alerts.push({
      code: "run_terminal_coverage_low",
      message: "Run terminal observability coverage dropped below SLO target.",
      owner: "runtime-oncall",
      severity: "critical",
      target: snapshot.runTerminalCoverage.target,
      value: snapshot.runTerminalCoverage.coverageRate,
    });
  }

  if (
    snapshot.waitAfterTerminal.samples >= 20 &&
    snapshot.waitAfterTerminal.p95Ms > snapshot.waitAfterTerminal.targetMs
  ) {
    alerts.push({
      code: "wait_p95_high",
      message: "Wait-after-terminal P95 latency exceeded the SLO threshold.",
      owner: "platform-oncall",
      severity:
        snapshot.waitAfterTerminal.p95Ms >= WAIT_CRITICAL_MS
          ? "critical"
          : "warning",
      target: snapshot.waitAfterTerminal.targetMs,
      value: snapshot.waitAfterTerminal.p95Ms,
    });
  }

  if (
    snapshot.idempotency.requestsWithKey >= 20 &&
    snapshot.idempotency.reuseRate < snapshot.idempotency.target
  ) {
    alerts.push({
      code: "idempotency_reuse_low",
      message: "Idempotency reuse ratio dropped below SLO target.",
      owner: "api-oncall",
      severity: "warning",
      target: snapshot.idempotency.target,
      value: snapshot.idempotency.reuseRate,
    });
  }

  return alerts;
};

const recordAlerts = (alerts: readonly AlertSnapshot[]): void => {
  const now = Date.now();
  const env = getServerEnv();

  const current = new Set<AlertCode>();
  for (const alert of alerts) {
    current.add(alert.code);
    const key = `${alert.code}:${alert.severity}`;
    const last = lastAlertEmitAt.get(key) ?? 0;
    const shouldEmit = now - last >= ALERT_DEDUP_WINDOW_MS;
    const prevSeverity = activeAlertStates.get(alert.code);
    if (!shouldEmit && prevSeverity === alert.severity) {
      continue;
    }
    lastAlertEmitAt.set(key, now);
    activeAlertStates.set(alert.code, alert.severity);
    alertHistory.push({ ...alert, timestamp: now });
    capArray(alertHistory, env.auditLogMaxEntries);
    logStructured(
      alert.severity === "critical" ? "error" : "warn",
      "slo.alert",
      {
        code: alert.code,
        owner: alert.owner,
        target: alert.target,
        value: alert.value,
      },
    );
  }

  for (const code of [...activeAlertStates.keys()]) {
    if (current.has(code)) {
      continue;
    }
    activeAlertStates.delete(code);
  }
};

const buildSnapshot = (): SloSnapshot => {
  pruneOldWindowData();
  const success = apiSamples.filter(
    (sample) => sample.classification === "success",
  ).length;
  const userErrors = apiSamples.filter(
    (sample) => sample.classification === "user_error",
  ).length;
  const serverErrors = apiSamples.filter(
    (sample) => sample.classification === "server_error",
  ).length;

  const nonUserTotal = success + serverErrors;
  const nonUserSuccessRate =
    nonUserTotal > 0 ? safeNumber(success / nonUserTotal) : 1;

  const observedRunIds = [...observedTerminalRuns.keys()];
  let covered = 0;
  for (const runId of observedRunIds) {
    if (terminalRunsWithEvents.has(runId)) {
      covered += 1;
    }
  }
  const coverageRate =
    observedRunIds.length > 0 ? safeNumber(covered / observedRunIds.length) : 1;

  const waitLatencyValues = waitSamples.map((sample) => sample.latencyMs);
  const waitP95Ms = percentile(waitLatencyValues, 0.95);

  const idempotencyRequested = idempotencySamples.length;
  const idempotencyReused = idempotencySamples.filter(
    (sample) => sample.reused,
  ).length;
  const idempotencyReuseRate =
    idempotencyRequested > 0
      ? safeNumber(idempotencyReused / idempotencyRequested)
      : 1;

  const snapshot: SloSnapshot = {
    alerts: [],
    api: {
      nonUserSuccessRate,
      pass: nonUserSuccessRate >= API_SUCCESS_TARGET,
      requests: apiSamples.length,
      serverErrors,
      success,
      target: API_SUCCESS_TARGET,
      userErrors,
    },
    generatedAt: Date.now(),
    idempotency: {
      pass: idempotencyReuseRate >= IDEMPOTENCY_REUSE_TARGET,
      requestsWithKey: idempotencyRequested,
      reuseRate: idempotencyReuseRate,
      reused: idempotencyReused,
      target: IDEMPOTENCY_REUSE_TARGET,
    },
    runTerminalCoverage: {
      coverageRate,
      observedTerminalRuns: observedRunIds.length,
      pass: coverageRate >= RUN_COVERAGE_TARGET,
      target: RUN_COVERAGE_TARGET,
      terminalRunsWithEvents: covered,
    },
    waitAfterTerminal: {
      p95Ms: waitP95Ms,
      pass: waitP95Ms <= WAIT_TARGET_MS,
      samples: waitSamples.length,
      targetMs: WAIT_TARGET_MS,
    },
    windowMs: WINDOW_MS,
  };

  const alerts = evaluateAlerts(snapshot);
  snapshot.alerts = alerts;
  recordAlerts(alerts);
  return snapshot;
};

export const listRecentApiSamples = (limit = 100): ApiSample[] => {
  pruneOldWindowData();
  const capped = Math.max(1, Math.min(500, Math.floor(limit)));
  return apiSamples.slice(-capped).reverse();
};

export const listRecentAlertSamples = (limit = 50): ObservabilityAlert[] => {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  return alertHistory.slice(-capped).reverse();
};

export const getSloSnapshot = (): SloSnapshot => buildSnapshot();

export const recordRunTerminalSnapshot = (
  runId: string,
  status: string,
): void => {
  if (!TERMINAL_STATUS.has(status)) {
    return;
  }
  pruneOldWindowData();
  observedTerminalRuns.set(runId, Date.now());
};

export const recordRunEvent = (event: {
  runId: string;
  status: string;
  type: string;
}): void => {
  if (!event.runId || !TERMINAL_STATUS.has(event.status)) {
    return;
  }
  if (!event.type.startsWith("run.")) {
    return;
  }
  pruneOldWindowData();
  terminalRunsWithEvents.set(event.runId, Date.now());
};

export const recordWaitAfterTerminalLatency = (latencyMs: number): void => {
  if (!Number.isFinite(latencyMs)) {
    return;
  }
  const env = getServerEnv();
  waitSamples.push({
    latencyMs: Math.max(0, Math.floor(latencyMs)),
    timestamp: Date.now(),
  });
  capArray(waitSamples, env.observabilityWaitSampleLimit);
  pruneOldWindowData();
};

export const withObservedRequest = async (
  req: Request,
  options: ObserveRouteOptions,
): Promise<Response> => {
  const env = getServerEnv();
  const requestId =
    req.headers.get("x-request-id")?.trim() || randomUUID().slice(0, 12);
  const startedAt = Date.now();
  const method = normalizeMethod(req.method);
  const route = normalizeRoute(options.route);
  const idempotencyRequested = Boolean(
    req.headers.get("idempotency-key")?.trim(),
  );
  let tenantId: string | undefined;
  let apiKeyId: string | undefined;

  const context: RouteObservationContext = {
    requestId,
    setIdentity: (identity) => {
      tenantId = identity.tenantId?.trim() || undefined;
      apiKeyId = identity.apiKeyId?.trim() || undefined;
    },
  };

  logStructured("info", "request.start", {
    method,
    requestId,
    route,
  });

  try {
    const response = await options.handler(context);
    const responseWithRequestId = appendRequestIdHeader(response, requestId);
    const status = responseWithRequestId.status;
    const durationMs = Math.max(0, Date.now() - startedAt);
    const idempotencyReused =
      responseWithRequestId.headers.get("x-idempotency-reused") === "1";

    apiSamples.push({
      apiKeyId,
      classification: classifyStatus(status),
      durationMs,
      idempotencyRequested,
      idempotencyReused,
      method,
      requestId,
      route,
      status,
      tenantId,
      timestamp: Date.now(),
    });
    capArray(apiSamples, env.observabilityRequestSampleLimit);

    if (idempotencyRequested) {
      idempotencySamples.push({
        reused: idempotencyReused,
        timestamp: Date.now(),
      });
      capArray(idempotencySamples, env.observabilityRequestSampleLimit);
    }
    pruneOldWindowData();

    logStructured("info", "request.finish", {
      duration_ms: durationMs,
      method,
      requestId,
      route,
      status,
      tenant_id: tenantId,
    });
    return responseWithRequestId;
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    apiSamples.push({
      apiKeyId,
      classification: "server_error",
      durationMs,
      idempotencyRequested,
      idempotencyReused: false,
      method,
      requestId,
      route,
      status: 500,
      tenantId,
      timestamp: Date.now(),
    });
    capArray(apiSamples, env.observabilityRequestSampleLimit);
    pruneOldWindowData();

    logStructured("error", "request.error", {
      duration_ms: durationMs,
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : String(error).slice(0, 500),
      method,
      requestId,
      route,
      status: 500,
      tenant_id: tenantId,
    });
    throw error;
  }
};
