# @ark/client

Thin official TypeScript client for the Ark execution API.

## What it wraps

- `GET /api/v1/platform`
- `GET /api/v1/tools/registry`
- `POST /api/v1/files`
- `POST /api/v1/execute`
- `POST /api/v1/execute/async`
- `GET /api/v1/jobs/{jobId}`
- `GET /api/v1/admin/api-keys`
- `POST /api/v1/admin/api-keys`
- `DELETE /api/v1/admin/api-keys/{keyId}`
- `GET /api/v1/admin/tenants`
- `POST /api/v1/admin/tenants`
- `GET /api/v1/admin/tenants/{tenantId}`
- `PATCH /api/v1/admin/tenants/{tenantId}`
- `GET /api/v1/admin/managed-tenants`
- `POST /api/v1/admin/managed-tenants`
- `GET /api/v1/admin/managed-tenants/{tenantId}`
- `PATCH /api/v1/admin/managed-tenants/{tenantId}`
- `POST /api/v1/admin/managed-tenants/{tenantId}/keys`
- `DELETE /api/v1/admin/managed-tenants/{tenantId}/keys/{keyId}`

The client is intentionally thin:
- no hidden workflow engine
- no prompt layer
- no model routing

Your agent keeps reasoning. Ark executes the work.

## Quick example

```ts
import { ArkClient } from "@ark/client";

const client = new ArkClient({
  baseUrl: "http://127.0.0.1:3010",
  apiKey: process.env.ARK_API_KEY,
});

const platform = await client.getPlatform();
const tools = await client.listTools();

const execution = await client.execute("convert.json_format", {
  input: "{\"ok\":true}",
  mode: "pretty",
});

console.log(platform.brand);
console.log(tools.total);
console.log(execution.result);
```

Bootstrap operator flow:

```ts
const keys = await client.listApiKeys();
const created = await client.createApiKey({
  tenantId: "demo-agent",
  scopes: ["execute:read", "execute:write", "runs:read"],
});

await client.revokeApiKey(created.key.id);
console.log(keys.total);
```

Tenant provisioning flow:

```ts
const tenant = await client.createTenant({
  id: "team-alpha",
  name: "Team Alpha",
  quota: {
    burstPerMinute: 30,
    concurrencyLimit: 2,
    monthlyLimit: 2000,
  },
});

console.log(tenant.tenant.id);
console.log(tenant.bootstrap_key.id);
console.log(tenant.bootstrap_api_key);
```

Managed tenant flow:

```ts
const managed = await client.createManagedTenant({
  id: "managed-team",
  name: "Managed Team",
});

const detail = await client.getManagedTenant(managed.tenant.id, { limit: 10 });
const rotated = await client.createManagedTenantKey(managed.tenant.id);
await client.revokeManagedTenantKey(managed.tenant.id, rotated.tenant_key.id);

console.log(detail.usage_summary.month.totalRuns);
```

## Local validation

Compile the SDK from the repo root:

```bash
pnpm sdk:build:ts
```

Use it against an Ark deployment configured with either:
- `trusted_local`
- or a real deployment API key issued by `scripts/issue-local-api-key.mjs`

For the full self-hosted tenant + key lifecycle, run:

```bash
pnpm local:server:smoke
```
