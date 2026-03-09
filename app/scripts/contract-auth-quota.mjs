const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const fullAccessKey =
  process.env.OMNIAGENT_TEST_API_KEY?.trim() ||
  process.env.OMNIAGENT_API_KEY?.trim() ||
  "";
const readOnlyKey = process.env.OMNIAGENT_TEST_READONLY_API_KEY?.trim() || "";
const lowQuotaKey = process.env.OMNIAGENT_TEST_LOW_QUOTA_API_KEY?.trim() || "";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const readBodySafe = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

const apiHeaders = (apiKey, base = {}) => {
  const headers = { ...base };
  if (apiKey?.trim()) {
    headers["X-API-Key"] = apiKey.trim();
  }
  return headers;
};

const executeJsonFormat = async (apiKey, text) => {
  return fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: apiHeaders(apiKey, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      tool: "official.utility.json_format",
      params: { text },
    }),
  });
};

const main = async () => {
  console.log(`[auth-contract] app=${appBaseUrl}`);

  const noAuthRes = await fetch(`${appBaseUrl}/api/v1/tools?limit=1`, {
    method: "GET",
    cache: "no-store",
  });
  const noAuthBody = await readBodySafe(noAuthRes);
  const noAuthCode = noAuthBody?.error?.code;
  const strictMode = noAuthRes.status === 401;

  if (strictMode) {
    assert(
      noAuthCode === "auth_missing_credentials" ||
        noAuthCode === "auth_invalid_credentials",
      `Expected auth error code for strict mode, got: ${String(noAuthCode)}`,
    );
    console.log("[auth-contract] strict-mode detected (missing key denied)");
  } else {
    assert(
      noAuthRes.ok,
      `Expected trusted-local mode to allow missing key, got status=${noAuthRes.status}`,
    );
    console.log("[auth-contract] trusted-local mode detected");
  }

  if (fullAccessKey) {
    const allowRes = await fetch(`${appBaseUrl}/api/v1/tools?limit=1`, {
      method: "GET",
      cache: "no-store",
      headers: apiHeaders(fullAccessKey),
    });
    assert(allowRes.ok, `Expected full access key to allow tools list.`);
    console.log("[auth-contract] full-access key allow -> ok");
  } else if (strictMode) {
    throw new Error(
      "Strict mode is enabled but no OMNIAGENT_TEST_API_KEY/OMNIAGENT_API_KEY provided.",
    );
  } else {
    console.log("[auth-contract] full-access key not provided -> skipped");
  }

  if (readOnlyKey) {
    const denyWriteRes = await executeJsonFormat(readOnlyKey, '{"a":1}');
    const denyWriteBody = await readBodySafe(denyWriteRes);
    assert(
      denyWriteRes.status === 403,
      `Expected readonly key write denial (403), got ${denyWriteRes.status}`,
    );
    assert(
      denyWriteBody?.error?.code === "auth_forbidden_scope",
      `Expected auth_forbidden_scope, got ${String(denyWriteBody?.error?.code)}`,
    );
    console.log("[auth-contract] readonly scope deny -> ok");
  } else {
    console.log("[auth-contract] readonly key not provided -> skipped");
  }

  if (lowQuotaKey) {
    const first = await executeJsonFormat(lowQuotaKey, '{"quota":"first"}');
    assert(first.ok, "Low-quota key first request should pass.");
    const second = await executeJsonFormat(lowQuotaKey, '{"quota":"second"}');
    const secondBody = await readBodySafe(second);
    assert(
      second.status === 429,
      `Expected quota exhaustion on second request, got status=${second.status}`,
    );
    assert(
      typeof secondBody?.error?.code === "string" &&
        secondBody.error.code.startsWith("quota_"),
      `Expected quota_* error code, got ${String(secondBody?.error?.code)}`,
    );
    console.log(`[auth-contract] quota deny -> ${secondBody.error.code}`);
  } else {
    console.log("[auth-contract] low-quota key not provided -> skipped");
  }

  console.log("[auth-contract] PASS");
};

main().catch((error) => {
  console.error(
    "[auth-contract] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
