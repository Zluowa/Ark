import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const ensureJson = async (res, label) => {
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${label} returned non-json response`);
  }
  if (!res.ok) {
    throw new Error(
      `${label} failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
  return body;
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
    const body = await ensureJson(res, `GET /api/v1/jobs/${jobId}`);
    const status = body?.status;
    if (
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return body;
    }
    await sleep(200);
  }
  throw new Error(`job timeout: ${jobId}`);
};

const postResponses = async (payload, extraHeaders = {}) => {
  const res = await fetch(`${appBaseUrl}/api/v1/responses`, {
    method: "POST",
    headers: withAuthHeaders({
      "Content-Type": "application/json",
      ...extraHeaders,
    }),
    body: JSON.stringify(payload),
  });
  return { body: await res.json(), status: res.status };
};

const main = async () => {
  console.log(`[responses-contract] app=${appBaseUrl} ${authHint}`);

  const sync = await postResponses({
    input: "format this json",
    mode: "sync",
    params: { text: '{"k":1}' },
    tool: "official.utility.json_format",
  });
  assert(
    sync.status === 200,
    `sync responses expected 200, got ${sync.status}`,
  );
  assert(sync.body?.object === "response", "sync object must be response");
  assert(sync.body?.status === "completed", "sync status must be completed");
  assert(typeof sync.body?.run_id === "string", "sync run_id missing");
  assert(sync.body?.usage?.credits_used >= 0, "sync usage missing");

  const failure = await postResponses({
    mode: "sync",
    params: { text: '{"k":1}' },
    tool: "official.utility.not_exists",
  });
  assert(
    failure.status >= 400,
    `failure responses expected >=400, got ${failure.status}`,
  );
  assert(failure.body?.status === "failed", "failure status must be failed");
  assert(typeof failure.body?.run_id === "string", "failure run_id missing");
  assert(
    typeof failure.body?.error?.code === "string",
    "failure error code missing",
  );

  const idempotencyKey = `responses-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const idemPayload = {
    input: "format this json",
    mode: "sync",
    params: { text: '{"idem":1}' },
    source: "responses-contract",
    tool: "official.utility.json_format",
  };
  const firstIdem = await postResponses(idemPayload, {
    "Idempotency-Key": idempotencyKey,
  });
  assert(firstIdem.status === 200, "idempotent first call should be 200");
  const secondIdem = await postResponses(idemPayload, {
    "Idempotency-Key": idempotencyKey,
  });
  assert(secondIdem.status === 200, "idempotent replay should be 200");
  assert(secondIdem.body?.reused === true, "idempotent replay reused=true");
  assert(
    secondIdem.body?.run_id === firstIdem.body?.run_id,
    "idempotent replay should return same run_id",
  );

  const asyncResponse = await postResponses({
    input: "format this json asynchronously",
    mode: "async",
    params: { text: '{"async":1}' },
    tool: "official.utility.json_format",
  });
  assert(
    asyncResponse.status === 200,
    `async responses expected 200, got ${asyncResponse.status}`,
  );
  assert(
    asyncResponse.body?.status === "in_progress",
    `async status should be in_progress, got ${String(asyncResponse.body?.status)}`,
  );
  const asyncJobId = asyncResponse.body?.job_id;
  const asyncRunId = asyncResponse.body?.run_id;
  assert(typeof asyncJobId === "string", "async job_id missing");
  assert(typeof asyncRunId === "string", "async run_id missing");

  const terminal = await pollJobUntilTerminal(asyncJobId, 30000);
  assert(
    terminal?.status === "completed",
    `async terminal status should be completed, got ${String(terminal?.status)}`,
  );

  const runRes = await fetch(`${appBaseUrl}/api/runs/${asyncRunId}`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  const runBody = await ensureJson(runRes, "GET /api/runs/:id");
  assert(
    runBody?.run?.status === "succeeded",
    `run status should be succeeded, got ${String(runBody?.run?.status)}`,
  );

  console.log("[responses-contract] PASS");
};

main().catch((error) => {
  console.error(
    "[responses-contract] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
