import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const requests = Math.max(
  1,
  Number.parseInt(process.env.OMNIAGENT_PERF_REQUESTS ?? "30", 10) || 30,
);
const concurrency = Math.max(
  1,
  Number.parseInt(process.env.OMNIAGENT_PERF_CONCURRENCY ?? "5", 10) || 5,
);
const p95TargetMs = Math.max(
  100,
  Number.parseInt(process.env.OMNIAGENT_PERF_P95_TARGET_MS ?? "4000", 10) ||
    4000,
);

const percentile = (values, p) => {
  if (values.length < 1) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[idx] ?? 0;
};

const ensureOk = async (res, label) => {
  if (res.ok) {
    return;
  }
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 400)}`);
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
  const utilityBody = await utilityRes.json();
  const utilityToolId = utilityBody?.tools?.[0]?.id;
  if (typeof utilityToolId === "string" && utilityToolId.trim()) {
    return {
      id: utilityToolId.trim(),
      params: {
        text: '{"perf":true}',
      },
    };
  }

  const res = await fetch(`${appBaseUrl}/api/v1/tools?limit=1`, {
    method: "GET",
    headers: withAuthHeaders(),
    cache: "no-store",
  });
  await ensureOk(res, "GET /api/v1/tools");
  const body = await res.json();
  const toolId = body?.tools?.[0]?.id;
  if (typeof toolId !== "string" || !toolId.trim()) {
    throw new Error("No tool id resolved from /api/v1/tools.");
  }
  return {
    id: toolId.trim(),
    params: {},
  };
};

const executeOne = async (toolId, params) => {
  const startedAt = performance.now();
  const res = await fetch(
    `${appBaseUrl}/api/v1/tools/${encodeURIComponent(toolId)}/test`,
    {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        params,
      }),
    },
  );
  const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
  return {
    durationMs,
    ok: res.ok,
    status: res.status,
  };
};

const runPool = async (toolId, params) => {
  const queue = Array.from({ length: requests }, (_, i) => i);
  const results = [];

  const worker = async () => {
    while (queue.length > 0) {
      queue.pop();
      const result = await executeOne(toolId, params);
      results.push(result);
    }
  };

  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, requests) }, () => worker()),
  );
  const elapsedMs = Math.max(1, performance.now() - startedAt);
  return { elapsedMs, results };
};

const main = async () => {
  console.log(
    `[perf] app=${appBaseUrl} ${authHint} requests=${requests} concurrency=${concurrency}`,
  );
  const tool = await fetchTool();
  const toolId = tool.id;
  const params = tool.params;
  console.log(`[perf] tool=${toolId}`);

  const { elapsedMs, results } = await runPool(toolId, params);
  const durations = results.map((item) => item.durationMs);
  const okCount = results.filter((item) => item.ok).length;
  const serverErrors = results.filter((item) => item.status >= 500).length;
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const throughput = Number(((results.length * 1000) / elapsedMs).toFixed(2));

  console.log(
    `[perf] total=${results.length} ok=${okCount} server_errors=${serverErrors}`,
  );
  console.log(`[perf] p50=${p50}ms p95=${p95}ms throughput=${throughput}/s`);

  if (serverErrors > 0) {
    throw new Error(`Server errors detected during perf run: ${serverErrors}`);
  }
  if (p95 > p95TargetMs) {
    throw new Error(`P95 ${p95}ms exceeds target ${p95TargetMs}ms`);
  }

  console.log("[perf] PASS");
};

main().catch((error) => {
  console.error(
    "[perf] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
