import { execSync } from "node:child_process";
import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";
const controlBaseUrl = process.env.OMNIAGENT_CONTROL_BASE_URL ?? appBaseUrl;
const restartCommand = process.env.OMNIAGENT_RESILIENCE_RESTART_COMMAND?.trim();

const sleep = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const ensureOk = async (res, label) => {
  if (res.ok) {
    return;
  }
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 500)}`);
};

const parseJsonSafe = async (res, label) => {
  try {
    return await res.json();
  } catch (error) {
    throw new Error(
      `${label} returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const extractRunIdFromSse = (raw) => {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload);
      const runId =
        parsed?.messageMetadata?.custom?.runId ??
        parsed?.messageMetadata?.runId ??
        parsed?.metadata?.custom?.runId;
      if (typeof runId === "string" && runId.trim()) {
        return runId.trim();
      }
    } catch {
      // Ignore malformed chunks.
    }
  }
  return undefined;
};

const parseSseEventIds = (raw) => {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("id: "))
    .map((line) => Number.parseInt(line.slice(4).trim(), 10))
    .filter((value) => Number.isFinite(value));
};

const fetchTool = async () => {
  const utilityRes = await fetch(
    `${appBaseUrl}/api/v1/tools?q=utility&limit=1`,
    {
      method: "GET",
      headers: withAuthHeaders(),
      cache: "no-store",
    },
  );
  await ensureOk(utilityRes, "GET /api/v1/tools?q=utility");
  const utilityPayload = await parseJsonSafe(
    utilityRes,
    "GET /api/v1/tools?q=utility",
  );
  const utilityToolId = utilityPayload?.tools?.[0]?.id;
  if (typeof utilityToolId === "string" && utilityToolId.trim()) {
    return {
      id: utilityToolId.trim(),
      params: {
        text: '{"resilience":true}',
      },
    };
  }

  const res = await fetch(`${appBaseUrl}/api/v1/tools?limit=1`, {
    method: "GET",
    headers: withAuthHeaders(),
    cache: "no-store",
  });
  await ensureOk(res, "GET /api/v1/tools");
  const payload = await parseJsonSafe(res, "GET /api/v1/tools");
  const toolId = payload?.tools?.[0]?.id;
  if (typeof toolId !== "string" || !toolId.trim()) {
    throw new Error("No tool found for resilience drill.");
  }
  return {
    id: toolId.trim(),
    params: {},
  };
};

const waitJobTerminal = async (jobId, timeoutMs = 45000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `${appBaseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: withAuthHeaders(),
        cache: "no-store",
      },
    );
    await ensureOk(res, "GET /api/v1/jobs/:jobId");
    const payload = await parseJsonSafe(res, "GET /api/v1/jobs/:jobId");
    if (
      payload?.status === "completed" ||
      payload?.status === "failed" ||
      payload?.status === "cancelled"
    ) {
      return payload;
    }
    await sleep(500);
  }
  throw new Error(`Job ${jobId} did not reach terminal state in time.`);
};

const runIdempotencyReplayCheck = async () => {
  const key = `resilience-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const message = {
    id: `msg-${Date.now()}`,
    role: "user",
    parts: [{ type: "text", text: "Reply with resilience ok" }],
  };
  const headers = withAuthHeaders({
    "Content-Type": "application/json",
    "Idempotency-Key": key,
    "X-Omni-Source": "resilience-drill",
  });

  const first = await fetch(`${appBaseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [message] }),
  });
  await ensureOk(first, "POST /api/chat first");
  const firstRunHeader = first.headers.get("x-run-id")?.trim();
  const firstRaw = await first.text();
  const firstRunId = firstRunHeader || extractRunIdFromSse(firstRaw);
  if (!firstRunId) {
    throw new Error("First idempotent chat did not return run id.");
  }

  const second = await fetch(`${appBaseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages: [message] }),
  });
  await ensureOk(second, "POST /api/chat replay");
  const secondBody = await parseJsonSafe(second, "POST /api/chat replay");
  const secondRunId =
    second.headers.get("x-run-id")?.trim() || secondBody?.runId;
  if (secondBody?.reused !== true) {
    throw new Error("Idempotent replay did not return reused=true.");
  }
  if (secondRunId !== firstRunId) {
    throw new Error("Idempotent replay returned different run id.");
  }
  return firstRunId;
};

const runEventsReplayCheck = async (runId) => {
  const first = await fetch(
    `${controlBaseUrl}/api/runs/${encodeURIComponent(runId)}/events`,
    {
      method: "GET",
      headers: withAuthHeaders({
        Accept: "text/event-stream",
      }),
      cache: "no-store",
    },
  );
  await ensureOk(first, "GET /api/runs/:id/events");
  const firstRaw = await first.text();
  const ids = parseSseEventIds(firstRaw);
  const afterId = ids.length > 0 ? Math.max(...ids) - 1 : 0;

  const second = await fetch(
    `${controlBaseUrl}/api/runs/${encodeURIComponent(runId)}/events?afterEventId=${Math.max(0, afterId)}`,
    {
      method: "GET",
      headers: withAuthHeaders({
        Accept: "text/event-stream",
      }),
      cache: "no-store",
    },
  );
  await ensureOk(second, "GET /api/runs/:id/events replay");
  const secondRaw = await second.text();
  const replayIds = parseSseEventIds(secondRaw);
  if (replayIds.length < 1) {
    throw new Error("Events replay returned no event ids.");
  }
};

const main = async () => {
  console.log(
    `[resilience] app=${appBaseUrl} control=${controlBaseUrl} ${authHint}`,
  );
  const tool = await fetchTool();
  const toolId = tool.id;
  const toolParams = tool.params;
  console.log(`[resilience] tool=${toolId}`);

  const asyncRes = await fetch(`${appBaseUrl}/api/v1/execute/async`, {
    method: "POST",
    headers: withAuthHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      params: toolParams,
      tool: toolId,
    }),
  });
  await ensureOk(asyncRes, "POST /api/v1/execute/async");
  const asyncBody = await parseJsonSafe(asyncRes, "POST /api/v1/execute/async");
  const jobId = asyncBody?.job_id;
  const runId = asyncBody?.run_id;
  if (typeof jobId !== "string" || typeof runId !== "string") {
    throw new Error("Async execute did not return job_id/run_id.");
  }

  if (restartCommand) {
    console.log(`[resilience] restart command: ${restartCommand}`);
    execSync(restartCommand, {
      shell: true,
      stdio: "inherit",
    });
  } else {
    console.log(
      "[resilience] restart command not configured, skip restart step",
    );
  }

  const job = await waitJobTerminal(jobId);
  console.log(`[resilience] async job terminal status=${job.status}`);

  const waited = await fetch(
    `${controlBaseUrl}/api/runs/${encodeURIComponent(runId)}/wait?timeoutMs=20000`,
    {
      method: "GET",
      headers: withAuthHeaders(),
      cache: "no-store",
    },
  );
  await ensureOk(waited, "GET /api/runs/:id/wait");
  const waitedBody = await parseJsonSafe(waited, "GET /api/runs/:id/wait");
  if (waitedBody?.done !== true) {
    throw new Error("Run wait did not return done=true.");
  }

  const replayRunId = await runIdempotencyReplayCheck();
  await runEventsReplayCheck(replayRunId);
  console.log("[resilience] PASS");
};

main().catch((error) => {
  console.error(
    "[resilience] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
