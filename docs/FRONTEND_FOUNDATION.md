# Frontend Foundation

Updated: 2026-02-25

## Goals

1. Ship on top of upstream templates, not custom UI scaffolding.
2. Keep runtime integration protocol-first (`/v1/responses`, run lifecycle APIs).
3. Make failures observable early (error boundary, load states, typed config).

## Stack Baseline

1. Next.js 16 + React 19 + TypeScript
2. assistant-ui starter (upstream)
3. Tailwind CSS v4 + Radix primitives + Biome

## Architecture

1. `app/` route layer and API handlers
2. `components/assistant-ui/` upstream chat primitives
3. `lib/config/` app/public config
4. `lib/server/` model provider resolution and server env
5. `lib/api/` control-plane client (`runs` endpoints)
6. `hooks/` reusable run lifecycle hooks

## Runtime Modes

1. Direct OpenAI mode
2. Relay-direct mode (`OMNIAGENT_RELAY_BASE_URL` + `OMNIAGENT_RELAY_API_KEY`)

The API route chooses mode at runtime through `lib/server/llm-provider.ts`.

## Local Ports

1. Frontend: `3010`
2. Reserved (never touched): `3000`, `4000`, `3004`, `3005`

## Quality Gate

Run this before merging:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Local start commands:

```bash
pnpm --dir app dev
pnpm --dir app dev:stack
```

## Next Frontend Steps

1. Replace remaining starter copy with product-specific content.
2. Add `run.events` SSE subscription for lower-latency status updates.
3. Add conversation persistence strategy (cloud or workspace-local).
4. Promote smoke script into CI and extend with UI E2E checks.
