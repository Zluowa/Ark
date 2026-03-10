# Local Agent Server

This document is the shortest path for turning one machine into a local Ark job server for agents.

## Goal

Run Ark locally so:
- Dynamic Island stays the lightweight consumer surface
- Web stays the full user workspace
- agents can call the same backend over API with one deployment key

## 1. Create a local deployment key

Preview a key and env snippet:

```bash
node scripts/issue-local-api-key.mjs
```

Write the key into `app/.env.local`:

```bash
node scripts/issue-local-api-key.mjs --write
```

That script switches the local deployment to:
- `OMNIAGENT_AUTH_MODE=api_key`
- one bootstrap operator API key
- one tenant id
- explicit API scopes

The bootstrap key is the platform-operator key for the local deployment. It can:
- list local deployment keys
- mint and revoke scoped keys
- create tenants and receive tenant bootstrap keys
- suspend a tenant without restarting Ark

## 2. Start the local job server

One command that issues a key if needed and starts the local API-key server:

```bash
node scripts/start-local-agent-server.mjs --issue-key --port 3211
```

Optional network note:
- if your host needs a proxy to reach sites like YouTube, set `MEDIA_PROXY` or `HTTPS_PROXY`
- if your host needs Xiaohongshu subtitle extraction, set `OMNIAGENT_XHS_COOKIE` or connect an XHS account for the tenant
- set `OMNIAGENT_XHS_BRIDGE_URL` when the XHS bridge is not running on `http://127.0.0.1:5556`
- on Windows, `start-local-agent-server.mjs` will also try to detect the system proxy automatically
- explicit env vars remain the portable contract for CI and non-Windows hosts

Manual path:

```bash
pnpm onboard --yes --profile full
pnpm --dir app dev
```

Optional native surface:

```bash
cargo run --manifest-path desktop/Cargo.toml -p omniagent-island
```

## 3. Manage scoped agent keys

With the bootstrap operator key, self-hosted Ark can mint and revoke scoped
agent keys without a restart:

```bash
curl -X POST http://127.0.0.1:3211/api/v1/admin/api-keys \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"demo-agent\",\"scopes\":[\"execute:read\",\"execute:write\",\"runs:read\"]}"
```

List current keys:

```bash
curl -s http://127.0.0.1:3211/api/v1/admin/api-keys \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY"
```

Revoke a locally managed key:

```bash
curl -X DELETE http://127.0.0.1:3211/api/v1/admin/api-keys/YOUR_KEY_ID \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY"
```

## 4. Provision a tenant

Create a tenant with a default quota policy and receive its bootstrap key:

```bash
curl -X POST http://127.0.0.1:3211/api/v1/admin/tenants \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"team-alpha\",\"name\":\"Team Alpha\",\"quota\":{\"burst_per_minute\":30,\"concurrency_limit\":2,\"monthly_limit\":2000}}"
```

List tenants:

```bash
curl -s http://127.0.0.1:3211/api/v1/admin/tenants \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY"
```

Update a tenant:

```bash
curl -X PATCH http://127.0.0.1:3211/api/v1/admin/tenants/team-alpha \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"suspended\"}"
```

The tenant bootstrap key returned from creation is not platform admin. It can:
- list only its own tenant keys
- mint only tenant-scoped runtime keys
- not list tenants
- not mint `admin:*` or `tenants:*` scopes

## 5. Verify the API contract

Public discovery:

```bash
curl -s http://127.0.0.1:3211/api/v1/platform
curl -s http://127.0.0.1:3211/api/v1/tools/registry
```

Authenticated execution:

```bash
curl -X POST http://127.0.0.1:3211/api/v1/execute \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"tool\":\"convert.json_format\",\"params\":{\"input\":\"{\\\"ok\\\":true}\",\"mode\":\"pretty\"}}"
```

Managed Ark-key control plane:

```bash
curl -X POST http://127.0.0.1:3211/api/v1/admin/managed-tenants \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"managed-team\",\"name\":\"Managed Team\",\"quota\":{\"burst_per_minute\":30,\"concurrency_limit\":2,\"monthly_limit\":2000}}"

curl -s http://127.0.0.1:3211/api/v1/admin/managed-tenants \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY"

curl -s http://127.0.0.1:3211/api/v1/admin/managed-tenants/managed-team \
  -H "X-API-Key: YOUR_BOOTSTRAP_KEY"
```

## 6. Use an official SDK

TypeScript:
- [sdk/typescript/README.md](../sdk/typescript/README.md)

Python:
- [sdk/python/README.md](../sdk/python/README.md)

MCP:
- [docs/MCP_SERVER.md](MCP_SERVER.md)

## 7. Full local smoke

This simulates a real agent-integration path against a strict `api_key` local server:

```bash
pnpm local:server:smoke
```

It validates:
- public discovery endpoints
- strict key enforcement
- operator key listing
- tenant creation and inspection
- tenant quota update
- tenant bootstrap scope boundaries
- scoped key creation
- sync execution
- async execution + job polling
- billing summary and usage
- key revocation
- tenant suspension enforcement
- TypeScript SDK
- Python SDK
- MCP initialize + tools/list + tools/call
- real Bilibili + YouTube + Douyin + direct-URL remote subtitle extraction
- local managed Ark-key issuance smoke
- managed tenant listing, detail, usage visibility, tenant-key mint, and tenant-key revoke
- Windows-safe local server startup and teardown

## 8. Product truth

Today in the public repo:
- local/self-hosted mode is real
- one deployment key per local deployment is real
- multi-tenant self-hosted provisioning is real
- local `managed_ark_key` operator mode is real
- Dynamic Island, Web, and API all point at the same backend

Not yet live in the public repo:
- SaaS billing and hosted multitenancy
