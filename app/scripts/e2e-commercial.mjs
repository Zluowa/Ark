import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";
const controlBaseUrl = process.env.OMNIAGENT_CONTROL_BASE_URL ?? appBaseUrl;

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

const fetchJson = async (url, options, label) => {
  const res = await fetch(url, options);
  await ensureOk(res, label);
  return parseJsonSafe(res, label);
};

const pickTool = async () => {
  const utilityPayload = await fetchJson(
    `${appBaseUrl}/api/v1/tools?q=utility&limit=1`,
    {
      method: "GET",
      headers: withAuthHeaders(),
      cache: "no-store",
    },
    "GET /api/v1/tools?q=utility",
  );
  const utilityToolId = utilityPayload?.tools?.[0]?.id;
  if (typeof utilityToolId === "string" && utilityToolId.trim()) {
    return {
      id: utilityToolId.trim(),
      params: {
        text: '{"hello":"world"}',
      },
    };
  }

  const payload = await fetchJson(
    `${appBaseUrl}/api/v1/tools?limit=1`,
    {
      method: "GET",
      headers: withAuthHeaders(),
      cache: "no-store",
    },
    "GET /api/v1/tools",
  );
  const toolId = payload?.tools?.[0]?.id;
  if (typeof toolId !== "string" || !toolId.trim()) {
    throw new Error("No tool found in /api/v1/tools.");
  }
  return {
    id: toolId.trim(),
    params: {},
  };
};

const waitJobTerminal = async (jobId, timeoutMs = 45000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await fetchJson(
      `${appBaseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: withAuthHeaders(),
        cache: "no-store",
      },
      "GET /api/v1/jobs/:jobId",
    );
    if (
      job?.status === "completed" ||
      job?.status === "failed" ||
      job?.status === "cancelled"
    ) {
      return job;
    }
    await sleep(400);
  }
  throw new Error(`Async job did not reach terminal status in ${timeoutMs}ms.`);
};

const testUploadFlow = async () => {
  const form = new FormData();
  const blob = new Blob(["hello omniagent"], { type: "text/plain" });
  form.append("file", blob, "hello.txt");
  form.append("scope", "e2e");

  const res = await fetch(`${appBaseUrl}/api/v1/files`, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  if (res.status === 503) {
    const body = await parseJsonSafe(res, "POST /api/v1/files");
    if (body?.error?.code === "artifact_store_unavailable") {
      console.log("[e2e] upload=skipped artifact store unavailable");
      return;
    }
  }
  await ensureOk(res, "POST /api/v1/files");
  const body = await parseJsonSafe(res, "POST /api/v1/files");
  if (!body?.ok || !Array.isArray(body.files) || body.files.length < 1) {
    throw new Error("Upload flow returned unexpected payload.");
  }
  console.log(`[e2e] upload=count:${body.count}`);
};

const main = async () => {
  console.log(`[e2e] app=${appBaseUrl} control=${controlBaseUrl} ${authHint}`);
  const tool = await pickTool();
  const toolId = tool.id;
  const toolParams = tool.params;
  console.log(`[e2e] tool=${toolId}`);

  const syncTest = await fetchJson(
    `${appBaseUrl}/api/v1/tools/${encodeURIComponent(toolId)}/test`,
    {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        params: toolParams,
      }),
    },
    "POST /api/v1/tools/:toolId/test",
  );
  if (typeof syncTest?.run_id !== "string") {
    throw new Error("Tool test did not return run_id.");
  }
  console.log(
    `[e2e] tools.test run=${syncTest.run_id} status=${syncTest.status}`,
  );

  const asyncExec = await fetchJson(
    `${appBaseUrl}/api/v1/execute/async`,
    {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        params: toolParams,
        tool: toolId,
      }),
    },
    "POST /api/v1/execute/async",
  );
  const asyncJob = await waitJobTerminal(asyncExec.job_id);
  console.log(
    `[e2e] execute.async job=${asyncExec.job_id} status=${asyncJob.status}`,
  );

  const dispatchSync = await fetchJson(
    `${appBaseUrl}/api/v1/dispatch`,
    {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        mode: "sync",
        params: toolParams,
        tool: toolId,
      }),
    },
    "POST /api/v1/dispatch sync",
  );
  if (!dispatchSync?.ok) {
    throw new Error("Dispatch sync did not return ok=true.");
  }
  console.log("[e2e] dispatch.sync ok");

  const responsesAsync = await fetchJson(
    `${appBaseUrl}/api/v1/responses`,
    {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        input: "run async response",
        mode: "async",
        params: toolParams,
        tool: toolId,
      }),
    },
    "POST /api/v1/responses async",
  );
  if (typeof responsesAsync?.run_id !== "string") {
    throw new Error("Responses async did not return run_id.");
  }
  const waited = await fetchJson(
    `${controlBaseUrl}/api/runs/${encodeURIComponent(responsesAsync.run_id)}/wait?timeoutMs=20000`,
    {
      method: "GET",
      headers: withAuthHeaders(),
      cache: "no-store",
    },
    "GET /api/runs/:id/wait",
  );
  if (waited?.done !== true) {
    throw new Error("Responses async run did not reach done=true.");
  }
  console.log(`[e2e] responses.async run=${responsesAsync.run_id} done=true`);

  await testUploadFlow();
  console.log("[e2e] PASS");
};

main().catch((error) => {
  console.error(
    "[e2e] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
