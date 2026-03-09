import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const sleep = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

const postSpawn = async (payload) => {
  const res = await fetch(`${appBaseUrl}/api/v1/subagents/spawn`, {
    method: "POST",
    headers: withAuthHeaders({
      "Content-Type": "application/json",
      "X-Omni-Source": "subagent-contract",
    }),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { body, status: res.status };
};

const getSubagent = async (subagentId) => {
  const res = await fetch(`${appBaseUrl}/api/v1/subagents/${subagentId}`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  return ensureJson(res, `GET /api/v1/subagents/${subagentId}`);
};

const waitSubagent = async (subagentId, timeoutMs = 30000) => {
  const res = await fetch(
    `${appBaseUrl}/api/v1/subagents/${subagentId}/wait?timeoutMs=${timeoutMs}`,
    {
      method: "GET",
      cache: "no-store",
      headers: withAuthHeaders(),
    },
  );
  return ensureJson(res, `GET /api/v1/subagents/${subagentId}/wait`);
};

const cancelSubagent = async (subagentId, reason) => {
  const res = await fetch(
    `${appBaseUrl}/api/v1/subagents/${subagentId}/cancel?reason=${encodeURIComponent(reason)}`,
    {
      method: "POST",
      headers: withAuthHeaders(),
    },
  );
  return ensureJson(res, `POST /api/v1/subagents/${subagentId}/cancel`);
};

const getRun = async (runId) => {
  const res = await fetch(`${appBaseUrl}/api/runs/${runId}`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  const body = await ensureJson(res, `GET /api/runs/${runId}`);
  return body?.run;
};

const pollUsage = async (subagentId, timeoutMs = 20000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const detail = await getSubagent(subagentId);
    if (detail?.subagent?.usage) {
      return detail.subagent.usage;
    }
    await sleep(250);
  }
  return undefined;
};

const isTerminal = (status) => {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
};

const main = async () => {
  console.log(`[subagents-contract] app=${appBaseUrl} ${authHint}`);

  const parent = await postSpawn({
    tool: "official.utility.json_format",
    params: { text: '{"subagent":"parent"}' },
  });
  assert(
    parent.status === 200,
    `parent spawn expected 200, got ${parent.status}`,
  );
  const parentId = parent.body?.subagent_id;
  const parentRunId = parent.body?.run_id;
  assert(typeof parentId === "string", "parent subagent_id missing");
  assert(typeof parentRunId === "string", "parent run_id missing");

  const parentDetail = await getSubagent(parentId);
  assert(
    parentDetail?.subagent?.spawn_depth === 0,
    "parent spawn_depth must be 0",
  );
  assert(
    !parentDetail?.subagent?.spawned_by,
    "parent spawned_by should be empty",
  );

  const parentWait = await waitSubagent(parentId, 30000);
  assert(parentWait?.done === true, "parent wait should complete");
  assert(
    isTerminal(parentWait?.run?.status),
    `parent wait terminal status expected, got ${String(parentWait?.run?.status)}`,
  );

  const child = await postSpawn({
    spawned_by: parentId,
    requested_scopes: ["execute:read"],
    tool: "official.utility.json_format",
    params: { text: '{"subagent":"child"}' },
  });
  assert(child.status === 200, `child spawn expected 200, got ${child.status}`);
  const childId = child.body?.subagent_id;
  const childRunId = child.body?.run_id;
  assert(typeof childId === "string", "child subagent_id missing");
  assert(typeof childRunId === "string", "child run_id missing");

  const childDetail = await getSubagent(childId);
  assert(
    childDetail?.subagent?.spawned_by === parentId,
    "child spawned_by should point to parent",
  );
  assert(
    childDetail?.subagent?.spawn_depth === 1,
    "child spawn_depth must be 1",
  );
  const childScopes = Array.isArray(childDetail?.subagent?.effective_scopes)
    ? childDetail.subagent.effective_scopes
    : [];
  assert(
    childScopes.includes("execute:read"),
    "child should keep requested lower privilege scope",
  );
  assert(
    !childScopes.includes("execute:write"),
    "child should not contain elevated execute:write scope",
  );

  const grandchildDenied = await postSpawn({
    spawned_by: childId,
    requested_scopes: ["execute:write"],
    tool: "official.utility.json_format",
    params: { text: '{"subagent":"grandchild"}' },
  });
  assert(
    grandchildDenied.status === 403,
    `grandchild spawn should be denied with 403, got ${grandchildDenied.status}`,
  );
  const denyCode = grandchildDenied.body?.error?.code;
  assert(
    denyCode === "subagent_parent_scope_forbidden" ||
      denyCode === "subagent_scope_forbidden",
    `grandchild deny code mismatch: ${String(denyCode)}`,
  );

  const runBeforeCancel = await getRun(childRunId);
  assert(
    runBeforeCancel?.spawnedBy === parentId,
    "child run spawnedBy should match parent",
  );
  assert(runBeforeCancel?.spawnDepth === 1, "child run spawnDepth must be 1");

  const childWaitFirst = await waitSubagent(childId, 30000);
  assert(childWaitFirst?.done === true, "child wait should complete");

  await cancelSubagent(childId, "lineage-check");
  const runAfterCancel = await getRun(childRunId);
  assert(
    runAfterCancel?.spawnedBy === runBeforeCancel?.spawnedBy,
    "spawnedBy must remain immutable after cancel",
  );
  assert(
    runAfterCancel?.spawnDepth === runBeforeCancel?.spawnDepth,
    "spawnDepth must remain immutable after cancel",
  );

  const childWaitSecond = await waitSubagent(childId, 1500);
  assert(childWaitSecond?.done === true, "terminal wait should stay done=true");
  assert(
    childWaitSecond?.run?.status === childWaitFirst?.run?.status,
    "wait should be side-effect free for terminal child run",
  );

  const recentListRes = await fetch(
    `${appBaseUrl}/api/v1/subagents?view=recent&limit=20`,
    {
      method: "GET",
      cache: "no-store",
      headers: withAuthHeaders(),
    },
  );
  const recentList = await ensureJson(recentListRes, "GET /api/v1/subagents");
  const ids = new Set(
    (Array.isArray(recentList?.subagents) ? recentList.subagents : [])
      .map((item) => item?.id)
      .filter((id) => typeof id === "string"),
  );
  assert(ids.has(parentId), "recent list should include parent subagent");
  assert(ids.has(childId), "recent list should include child subagent");

  const usage = await pollUsage(childId, 20000);
  assert(usage, "child subagent usage should be recorded");

  console.log("[subagents-contract] PASS");
};

main().catch((error) => {
  console.error(
    "[subagents-contract] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
