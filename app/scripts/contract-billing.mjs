import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const ensureOk = async (res, label) => {
  if (res.ok) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 500)}`);
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const sleep = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const pollJobUntilTerminal = async (jobId, timeoutMs = 30000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const res = await fetch(`${appBaseUrl}/api/v1/jobs/${jobId}`, {
      method: "GET",
      cache: "no-store",
      headers: withAuthHeaders(),
    });
    await ensureOk(res, `GET /api/v1/jobs/${jobId}`);
    const body = await res.json();
    const status = body?.status;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return body;
    }
    await sleep(250);
  }
  throw new Error(`Job timeout: ${jobId}`);
};

const getSummary = async () => {
  const res = await fetch(`${appBaseUrl}/api/v1/billing/summary`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  await ensureOk(res, "GET /api/v1/billing/summary");
  const body = await res.json();
  return body?.summary;
};

const main = async () => {
  console.log(`[billing-contract] app=${appBaseUrl} ${authHint}`);
  const before = await getSummary();
  const beforeDayRuns = Number(before?.day?.totalRuns ?? 0);
  const beforeDayCredits = Number(before?.day?.totalCredits ?? 0);

  const syncRes = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      tool: "official.utility.json_format",
      params: {
        text: '{"billing":"sync"}',
      },
    }),
  });
  await ensureOk(syncRes, "POST /api/v1/execute");
  const syncBody = await syncRes.json();
  assert(syncBody?.status === "success", "sync execute must succeed");
  const syncRunId = syncBody?.run_id;
  assert(typeof syncRunId === "string", "sync run id missing");

  const asyncRes = await fetch(`${appBaseUrl}/api/v1/execute/async`, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      tool: "official.utility.json_format",
      params: {
        text: '{"billing":"async"}',
      },
    }),
  });
  await ensureOk(asyncRes, "POST /api/v1/execute/async");
  const asyncBody = await asyncRes.json();
  const asyncJobId = asyncBody?.job_id;
  const asyncRunId = asyncBody?.run_id;
  assert(typeof asyncJobId === "string", "async job id missing");
  assert(typeof asyncRunId === "string", "async run id missing");
  const terminal = await pollJobUntilTerminal(asyncJobId, 30000);
  assert(
    terminal?.status === "completed",
    `async job expected completed, got ${String(terminal?.status)}`,
  );

  const after = await getSummary();
  const afterDayRuns = Number(after?.day?.totalRuns ?? 0);
  const afterDayCredits = Number(after?.day?.totalCredits ?? 0);
  assert(
    afterDayRuns >= beforeDayRuns + 2,
    `day total runs should increase by >=2, before=${beforeDayRuns} after=${afterDayRuns}`,
  );
  assert(
    afterDayCredits >= beforeDayCredits,
    `day credits should not decrease, before=${beforeDayCredits} after=${afterDayCredits}`,
  );

  const usageRes = await fetch(`${appBaseUrl}/api/v1/billing/usage?limit=50`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  await ensureOk(usageRes, "GET /api/v1/billing/usage");
  const usageBody = await usageRes.json();
  const usage = Array.isArray(usageBody?.usage) ? usageBody.usage : [];
  const runIds = new Set(
    usage
      .map((item) => (typeof item?.runId === "string" ? item.runId : ""))
      .filter(Boolean),
  );
  assert(runIds.has(syncRunId), "usage list missing sync run record");
  assert(runIds.has(asyncRunId), "usage list missing async run record");

  console.log(
    `[billing-contract] day.runs ${beforeDayRuns} -> ${afterDayRuns}; day.credits ${beforeDayCredits} -> ${afterDayCredits}`,
  );
  console.log("[billing-contract] PASS");
};

main().catch((error) => {
  console.error(
    "[billing-contract] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
