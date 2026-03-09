import { authHint, withAuthHeaders } from "./_auth-headers.mjs";

const appBaseUrl =
  process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";

const configuredRateLimit = Math.max(
  1,
  Number.parseInt(
    process.env.OMNIAGENT_SECURITY_WRITE_RATE_PER_MINUTE ?? "120",
    10,
  ) || 120,
);
const configuredJsonLimit = Math.max(
  1024,
  Number.parseInt(
    process.env.OMNIAGENT_SECURITY_JSON_MAX_BYTES ?? "1048576",
    10,
  ) || 1048576,
);
const hasApiKeyAuth = Boolean(
  process.env.OMNIAGENT_API_KEY?.trim() ||
    process.env.OMNIAGENT_TEST_API_KEY?.trim(),
);

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
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

const testPayloadLimit = async () => {
  const oversized = "x".repeat(configuredJsonLimit + 2048);
  const res = await fetch(`${appBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: withAuthHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      params: {
        oversized,
      },
      tool: "oversized-test",
    }),
  });
  ensure(
    res.status === 413,
    `Expected 413 for payload limit, got ${res.status}`,
  );
  const body = await parseJsonSafe(res, "payload limit check");
  ensure(
    body?.error?.code === "payload_too_large",
    "Expected payload_too_large error code.",
  );
  console.log("[security] payload limit check passed");
};

const testRateLimit = async () => {
  if (!hasApiKeyAuth) {
    console.log(
      "[security] rate limit check skipped (trusted_local bypass without api key)",
    );
    return;
  }
  if (configuredRateLimit > 250) {
    console.log(
      `[security] rate limit check skipped (configured limit ${configuredRateLimit} > 250)`,
    );
    return;
  }

  const attempts = configuredRateLimit + 2;
  let blocked = 0;
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(`${appBaseUrl}/api/v1/dispatch`, {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({}),
    });
    if (res.status === 429) {
      blocked += 1;
    }
  }
  ensure(blocked > 0, "Expected at least one 429 from write rate limit.");
  console.log(`[security] rate limit check passed blocked=${blocked}`);
};

const testAuditVisibility = async () => {
  const res = await fetch(`${appBaseUrl}/api/v1/admin/observability?limit=20`, {
    method: "GET",
    headers: withAuthHeaders(),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    console.log(
      "[security] audit visibility skipped (admin scope unavailable)",
    );
    return;
  }
  ensure(
    res.ok,
    `Expected admin observability endpoint to be available, got ${res.status}`,
  );
  const body = await parseJsonSafe(res, "admin observability");
  ensure(Array.isArray(body?.recent_audit), "recent_audit should be an array.");
  ensure(body.recent_audit.length > 0, "recent_audit should not be empty.");
  console.log(
    `[security] audit visibility passed count=${body.recent_audit.length}`,
  );
};

const main = async () => {
  console.log(`[security] app=${appBaseUrl} ${authHint}`);
  await testPayloadLimit();
  await testRateLimit();
  await testAuditVisibility();
  console.log("[security] PASS");
};

main().catch((error) => {
  console.error(
    "[security] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
