import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

const readArg = (flag, fallback = "") => {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  const inline = args.find((value) => value.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1);
  }
  return fallback;
};

const baseUrl = readArg("--base-url", process.env.ARK_REMOTE_BASE_URL ?? "");
const operatorKey = readArg("--operator-key", process.env.ARK_REMOTE_OPERATOR_KEY ?? "");
const outDir = resolve(process.cwd(), readArg("--out-dir", ".moss/deployment"));
const outPath = resolve(outDir, "server-deploy-smoke.json");

if (!baseUrl) {
  throw new Error("Missing --base-url");
}
if (!operatorKey) {
  throw new Error("Missing --operator-key");
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json, text/html;q=0.9",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { response, text, body };
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });

  const homepage = await request("/");
  assert(homepage.response.ok, "homepage should return 200");
  assert(homepage.text.includes("Ark"), "homepage should contain Ark branding");

  const openSource = await request("/open-source");
  assert(openSource.response.ok, "/open-source should return 200");

  const developers = await request("/developers");
  assert(developers.response.ok, "/developers should return 200");

  const health = await request("/api/health");
  assert(health.response.ok, "health should return 200");

  const platform = await request("/api/v1/platform");
  assert(platform.response.ok, "platform contract should return 200");

  const adminHeaders = {
    "X-API-Key": operatorKey,
    "Content-Type": "application/json",
  };

  const tenantId = `remote-managed-${Date.now()}`;
  const created = await request("/api/v1/admin/managed-tenants", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: tenantId,
      name: "Remote Managed Smoke Tenant",
      quota: {
        burstPerMinute: 24,
        concurrencyLimit: 4,
        monthlyLimit: 240,
      },
    }),
  });
  assert(created.response.ok, "managed tenant creation should succeed");

  const firstTenantKey = created.body?.tenant_api_key;
  assert(typeof firstTenantKey === "string" && firstTenantKey, "tenant_api_key should exist");

  const managedList = await request("/api/v1/admin/managed-tenants", {
    headers: { "X-API-Key": operatorKey },
  });
  assert(managedList.response.ok, "managed tenant listing should succeed");

  const detail = await request(`/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}`, {
    headers: { "X-API-Key": operatorKey },
  });
  assert(detail.response.ok, "managed tenant detail should succeed");

  const rotated = await request(
    `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}/keys`,
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Remote Rotated Tenant Key",
        rotate: true,
      }),
    },
  );
  assert(rotated.response.ok, "managed tenant key mint should succeed");

  const rotatedKey = rotated.body?.tenant_api_key;
  const rotatedKeyId = rotated.body?.tenant_key?.id;
  assert(typeof rotatedKey === "string" && rotatedKey, "rotated api key should exist");
  assert(typeof rotatedKeyId === "string" && rotatedKeyId, "rotated key id should exist");

  const tenantHeaders = {
    "X-API-Key": rotatedKey,
    "Content-Type": "application/json",
  };

  const syncRun = await request("/api/v1/execute", {
    method: "POST",
    headers: tenantHeaders,
    body: JSON.stringify({
      tool: "convert.json_format",
      params: {
        input: "{\"remote\":true}",
        mode: "pretty",
      },
    }),
  });
  assert(syncRun.response.ok, "remote sync execution should succeed");
  assert(syncRun.body?.status === "success", "remote sync execution should return success");

  const asyncRun = await request("/api/v1/execute/async", {
    method: "POST",
    headers: tenantHeaders,
    body: JSON.stringify({
      tool: "convert.json_format",
      params: {
        input: "{\"remote_async\":true}",
        mode: "minify",
      },
    }),
  });
  assert(asyncRun.response.ok, "remote async execution should succeed");

  const jobId = asyncRun.body?.job_id;
  assert(typeof jobId === "string" && jobId, "remote async execution should return job_id");

  let completedJob;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = await request(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { "X-API-Key": rotatedKey },
    });
    if (job.response.ok && job.body?.status === "completed") {
      completedJob = job.body;
      break;
    }
    await sleep(500);
  }
  assert(completedJob?.status === "completed", "remote async job should complete");

  const revoked = await request(
    `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}/keys/${encodeURIComponent(rotatedKeyId)}`,
    {
      method: "DELETE",
      headers: { "X-API-Key": operatorKey },
    },
  );
  assert(revoked.response.ok, "managed tenant key revoke should succeed");

  const denied = await request("/api/v1/execute", {
    method: "POST",
    headers: tenantHeaders,
    body: JSON.stringify({
      tool: "convert.json_format",
      params: {
        input: "{\"should\":\"deny\"}",
        mode: "pretty",
      },
    }),
  });
  assert(denied.response.status === 401, "revoked key should be denied");

  const report = {
    ok: true,
    baseUrl,
    tenantId,
    homepage: {
      status: homepage.response.status,
      containsArkBranding: homepage.text.includes("Ark"),
    },
    openSource: { status: openSource.response.status },
    developers: { status: developers.response.status },
    health: { status: health.response.status, body: health.body },
    platform: {
      status: platform.response.status,
      serviceModes: platform.body?.service_modes?.map((item) => item.id) ?? [],
    },
    managed: {
      created: created.body,
      listCount: Array.isArray(managedList.body?.tenants) ? managedList.body.tenants.length : 0,
      detail: detail.body,
      sync: syncRun.body,
      async: completedJob,
      revoke: revoked.body,
      deniedStatus: denied.response.status,
    },
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
