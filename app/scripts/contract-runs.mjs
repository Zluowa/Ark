import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";
const controlBaseUrl = process.env.OMNIAGENT_CONTROL_BASE_URL ?? appBaseUrl;

const message = {
  id: `contract-${Date.now()}`,
  role: "user",
  parts: [{ type: "text", text: "Reply with: contract ok" }],
};

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 400)}`);
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const extractRunIdFromSse = (raw) => {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    const runId =
      parsed?.messageMetadata?.custom?.runId ??
      parsed?.messageMetadata?.runId ??
      parsed?.metadata?.custom?.runId;
    if (typeof runId === "string" && runId.trim()) {
      return runId.trim();
    }
  }
  return undefined;
};

const parseEventTypes = (raw) => {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("event: "))
    .map((line) => line.slice("event: ".length).trim())
    .filter(Boolean);
};

const wait = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const postWithRetry = async (
  url,
  options,
  attempts = 3,
  retryDelayMs = 1200,
) => {
  let lastRes;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, options);
      if (res.ok) {
        return res;
      }
      lastRes = res;
      if (res.status < 500 || i === attempts - 1) {
        return res;
      }
    } catch (error) {
      lastError = error;
      if (i === attempts - 1) {
        break;
      }
    }
    await wait(retryDelayMs);
  }
  if (lastRes) {
    return lastRes;
  }
  throw lastError instanceof Error ? lastError : new Error("POST failed");
};

const main = async () => {
  console.log(
    `[contract] app=${appBaseUrl} control=${controlBaseUrl} ${authHint}`,
  );
  const idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const source = "contract-suite";
  const idemHeaders = withAuthHeaders({
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    "X-Omni-Source": source,
  });

  const chatRes = await postWithRetry(`${appBaseUrl}/api/chat`, {
    method: "POST",
    headers: idemHeaders,
    body: JSON.stringify({ messages: [message] }),
  });
  await ensureOk(chatRes, "POST /api/chat");
  const headerRunId = chatRes.headers.get("x-run-id")?.trim();
  const chatRaw = await chatRes.text();
  const streamRunId = extractRunIdFromSse(chatRaw);
  const runId = headerRunId || streamRunId;
  assert(runId, "No run id found in chat response.");
  console.log(`[contract] runId=${runId}`);

  const replayRes = await postWithRetry(`${appBaseUrl}/api/chat`, {
    method: "POST",
    headers: idemHeaders,
    body: JSON.stringify({ messages: [message] }),
  });
  await ensureOk(replayRes, "POST /api/chat (idempotent replay)");
  const replayRunId = replayRes.headers.get("x-run-id")?.trim();
  const replayBody = await replayRes.json();
  assert(
    replayBody?.reused === true,
    "idempotent replay should return reused=true",
  );
  assert(
    replayRunId === runId || replayBody?.runId === runId,
    "idempotent replay should return same run id",
  );
  console.log(
    `[contract] idempotency.reused=true runId=${replayRunId ?? replayBody?.runId}`,
  );

  const statusRes = await fetch(`${controlBaseUrl}/api/runs/${runId}`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  await ensureOk(statusRes, "GET /api/runs/:id");
  const statusBody = await statusRes.json();
  console.log(
    `[contract] initial.status=${statusBody?.run?.status ?? "unknown"}`,
  );

  const waitRes = await fetch(
    `${controlBaseUrl}/api/runs/${runId}/wait?timeoutMs=20000`,
    {
      method: "GET",
      cache: "no-store",
      headers: withAuthHeaders(),
    },
  );
  await ensureOk(waitRes, "GET /api/runs/:id/wait");
  const waitBody = await waitRes.json();
  assert(waitBody?.done === true, "wait must complete with done=true");
  const waitedStatus = waitBody?.run?.status;
  assert(
    waitedStatus === "succeeded" ||
      waitedStatus === "failed" ||
      waitedStatus === "cancelled",
    `wait should return terminal status, got: ${String(waitedStatus)}`,
  );
  console.log(`[contract] wait.status=${waitedStatus}`);

  // wait-only semantic: wait must not cause cancellation side effects.
  const waitAgainRes = await fetch(
    `${controlBaseUrl}/api/runs/${runId}/wait?timeoutMs=1000`,
    {
      method: "GET",
      cache: "no-store",
      headers: withAuthHeaders(),
    },
  );
  await ensureOk(waitAgainRes, "GET /api/runs/:id/wait (again)");
  const waitAgainBody = await waitAgainRes.json();
  assert(waitAgainBody?.done === true, "terminal run should stay done=true");
  assert(
    waitAgainBody?.run?.status === waitedStatus,
    "wait should not mutate terminal status",
  );

  const eventsRes = await fetch(`${controlBaseUrl}/api/runs/${runId}/events`, {
    method: "GET",
    headers: withAuthHeaders({
      Accept: "text/event-stream",
    }),
    cache: "no-store",
  });
  await ensureOk(eventsRes, "GET /api/runs/:id/events");
  const eventsRaw = await eventsRes.text();
  const eventTypes = parseEventTypes(eventsRaw);
  assert(
    eventTypes.includes("run.accepted"),
    "events should include run.accepted",
  );
  assert(
    eventTypes.includes("run.succeeded") ||
      eventTypes.includes("run.failed") ||
      eventTypes.includes("run.cancelled"),
    "events should include a terminal run event",
  );
  console.log(`[contract] events=${eventTypes.join(", ")}`);

  console.log("[contract] PASS");
};

main().catch((error) => {
  console.error(
    "[contract] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
