# ark-sdk

Thin official Python client for the Ark execution API.

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

It stays intentionally small so backend agents and worker services can plug Ark in without a heavier framework dependency.

## Quick example

```python
from ark_sdk import ArkClient

client = ArkClient(
    base_url="http://127.0.0.1:3010",
    api_key=None,
)

platform = client.get_platform()
tools = client.list_tools()
execution = client.execute(
    "convert.json_format",
    {"input": "{\"ok\": true}", "mode": "pretty"},
)

print(platform["brand"])
print(tools["total"])
print(execution["result"])
```

Bootstrap operator flow:

```python
keys = client.list_api_keys()
created = client.create_api_key(
    tenant_id="demo-agent",
    scopes=["execute:read", "execute:write", "runs:read"],
)
client.revoke_api_key(created["key"]["id"])
print(keys["total"])
```

Tenant provisioning flow:

```python
tenant = client.create_tenant(
    id="team-alpha",
    name="Team Alpha",
    quota={
        "burst_per_minute": 30,
        "concurrency_limit": 2,
        "monthly_limit": 2000,
    },
)

print(tenant["tenant"]["id"])
print(tenant["bootstrap_key"]["id"])
print(tenant["bootstrap_api_key"])
```

Managed tenant flow:

```python
managed = client.create_managed_tenant(
    id="managed-team",
    name="Managed Team",
)

detail = client.get_managed_tenant(managed["tenant"]["id"], limit=10)
rotated = client.create_managed_tenant_key(managed["tenant"]["id"])
client.revoke_managed_tenant_key(
    managed["tenant"]["id"],
    rotated["tenant_key"]["id"],
)

print(detail["usage_summary"]["month"]["totalRuns"])
```

## Local validation

Syntax check:

```bash
python -m py_compile sdk/python/ark_sdk/client.py
```

Use it against an Ark deployment configured with either:
- `trusted_local`
- or a real deployment API key issued by `scripts/issue-local-api-key.mjs`

For the full self-hosted tenant + key lifecycle, run:

```bash
pnpm local:server:smoke
```
