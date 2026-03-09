import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";
const controlBaseUrl = process.env.OMNIAGENT_CONTROL_BASE_URL ?? appBaseUrl;

const message = {
  id: `smoke-${Date.now()}`,
  role: "user",
  parts: [{ type: "text", text: "Reply with: smoke ok" }],
};

const ensureOk = async (res, label) => {
  if (res.ok) {
    return;
  }
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 400)}`);
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

const wait = async (ms) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const postChatWithRetry = async (
  url,
  body,
  attempts = 3,
  retryDelayMs = 1200,
) => {
  let lastRes;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: withAuthHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(body),
      });
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

  throw lastError instanceof Error
    ? lastError
    : new Error("POST /api/chat failed");
};

const main = async () => {
  console.log(
    `[smoke] app=${appBaseUrl} control=${controlBaseUrl} ${authHint}`,
  );

  const chatRes = await postChatWithRetry(`${appBaseUrl}/api/chat`, {
    messages: [message],
  });
  await ensureOk(chatRes, "POST /api/chat");

  const rawStream = await chatRes.text();
  const runId = extractRunIdFromSse(rawStream);
  if (!runId) {
    throw new Error("No runId found in /api/chat stream metadata.");
  }
  console.log(`[smoke] runId=${runId}`);

  const statusRes = await fetch(`${controlBaseUrl}/api/runs/${runId}`, {
    method: "GET",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  await ensureOk(statusRes, "GET /api/runs/:id");
  const statusBody = await statusRes.json();
  console.log(`[smoke] status=${statusBody?.run?.status ?? "unknown"}`);

  const waitRes = await fetch(
    `${controlBaseUrl}/api/runs/${runId}/wait?timeoutMs=15000`,
    {
      method: "GET",
      cache: "no-store",
      headers: withAuthHeaders(),
    },
  );
  await ensureOk(waitRes, "GET /api/runs/:id/wait");
  const waitBody = await waitRes.json();
  console.log(
    `[smoke] wait.done=${String(waitBody?.done)} status=${waitBody?.run?.status ?? "unknown"}`,
  );

  if (waitBody?.done !== true) {
    await wait(800);
  }

  const cancelRes = await fetch(`${controlBaseUrl}/api/runs/${runId}/cancel`, {
    method: "POST",
    cache: "no-store",
    headers: withAuthHeaders(),
  });
  await ensureOk(cancelRes, "POST /api/runs/:id/cancel");
  const cancelBody = await cancelRes.json();
  console.log(`[smoke] cancel.status=${cancelBody?.run?.status ?? "unknown"}`);

  console.log("[smoke] PASS");
};

main().catch((error) => {
  console.error(
    "[smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
