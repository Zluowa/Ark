import { ArkClient } from "../sdk/typescript/dist/index.js";

const baseUrl = process.env.ARK_BASE_URL ?? process.env.OMNIAGENT_APP_BASE_URL ?? "http://127.0.0.1:3010";
const apiKey = process.env.ARK_API_KEY ?? process.env.OMNIAGENT_API_KEY;
const expectKeys = process.env.ARK_EXPECT_KEYS === "1" || process.env.ARK_EXPECT_ADMIN === "1";
const expectTenants = process.env.ARK_EXPECT_TENANTS === "1" || process.env.ARK_EXPECT_ADMIN === "1";
const expectManaged = process.env.ARK_EXPECT_MANAGED === "1";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const client = new ArkClient({ baseUrl, apiKey });

  const platform = await client.getPlatform();
  assert(platform?.brand?.name === "Ark", "platform.brand.name should be Ark");

  const tools = await client.listTools();
  assert(Number(tools.total) > 0, "tools.total should be > 0");

  if (expectKeys) {
    const keys = await client.listApiKeys();
    assert(Number(keys.total) > 0, "listApiKeys should return at least one key");
  }
  if (expectTenants) {
    const tenants = await client.listTenants();
    assert(Number(tenants.total) > 0, "listTenants should return at least one tenant");
  }
  if (expectManaged) {
    const managedTenantId =
      process.env.ARK_MANAGED_TENANT_ID || `sdk-managed-tenant-${Date.now()}`;
    const managedListBefore = await client.listManagedTenants();
    assert(managedListBefore.ok === true, "listManagedTenants should succeed");
    const managed = await client.createManagedTenant({
      id: managedTenantId,
      name: "SDK Managed Tenant",
      quota: {
        burstPerMinute: 12,
        concurrencyLimit: 2,
        monthlyLimit: 120,
      },
    });
    assert(managed.ok === true, "createManagedTenant should succeed");
    assert(managed.service_mode === "managed_ark_key", "createManagedTenant should return managed mode");
    assert(typeof managed.tenant_api_key === "string" && managed.tenant_api_key, "createManagedTenant should return tenant_api_key");
    const managedDetail = await client.getManagedTenant(managedTenantId, {
      limit: 5,
    });
    assert(managedDetail.tenant.id === managedTenantId, "getManagedTenant should return requested tenant");
    const managedKey = await client.createManagedTenantKey(managedTenantId);
    assert(typeof managedKey.tenant_api_key === "string" && managedKey.tenant_api_key, "createManagedTenantKey should return tenant_api_key");
    const revokedManagedKey = await client.revokeManagedTenantKey(
      managedTenantId,
      managedKey.tenant_key.id,
    );
    assert(revokedManagedKey.tenant_key.status === "revoked", "revokeManagedTenantKey should revoke key");
  }

  const execution = await client.execute("convert.json_format", {
    input: "{\"ok\":true}",
    mode: "pretty",
  });
  assert(execution.status === "success", "sync execute should succeed");

  const asyncExecution = await client.executeAsync("convert.json_format", {
    input: "{\"async\":true}",
    mode: "minify",
  });
  assert(typeof asyncExecution.job_id === "string", "async execute should return job_id");

  const job = await client.pollJob(asyncExecution.job_id, {
    intervalMs: 250,
    timeoutMs: 15000,
  });
  assert(job.status === "completed", "async job should complete");

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    expectKeys,
    expectTenants,
    expectManaged,
    usedApiKey: Boolean(apiKey),
    toolTotal: tools.total,
    jobStatus: job.status,
  }, null, 2));
};

main().catch((error) => {
  console.error(
    "[sdk-ts] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
