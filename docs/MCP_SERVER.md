# Ark MCP Server

Ark now ships a real stdio MCP adapter on top of the same execution API used by
Island, Web, SDKs, and self-hosted agent integrations.

## What it does

- speaks MCP over stdio
- exposes live Ark tools through `tools/list`
- forwards `tools/call` to Ark's execution API
- works with the same tenant-scoped runtime key model as the REST API

This is an adapter layer, not a separate tool runtime. The product core is still:
- REST API
- async jobs
- artifact delivery
- self-hosted operator and tenant control plane

## Run it

Point the adapter at an Ark deployment:

```bash
set ARK_BASE_URL=http://127.0.0.1:3010
set ARK_API_KEY=your_runtime_key
pnpm mcp:start
```

If your local Ark server is running in `trusted_local` mode, the key can be omitted.
For strict `api_key` mode, use a real tenant-scoped runtime key.

## Smoke it

The repo includes a real smoke that validates:
- `initialize`
- `tools/list`
- `tools/call`

Run:

```bash
pnpm mcp:smoke
```

Or, for the full self-hosted contract including operator, tenant, SDK, and MCP:

```bash
pnpm local:server:smoke
```

## Current behavior

- tool discovery is backed by the live Ark catalog
- `tools/list` builds `inputSchema` from each Ark tool manifest
- `tools/call` currently uses sync execution under the hood
- long-running async job orchestration is still handled through the REST API

## Product truth

Live today:
- REST API
- TypeScript SDK
- Python SDK
- MCP server
- self-hosted operator key control plane
- self-hosted tenant provisioning

Still planned:
- skill packs built on top of the same execution layer
- managed Ark-issued hosted keys
- hosted commercial multitenancy and billing
