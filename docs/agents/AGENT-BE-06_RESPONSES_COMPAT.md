# AGENT-BE-06: Responses API Compatibility

## Mission

Ship `/api/v1/responses` compatibility to reduce B-end integration friction with existing OpenAI-style agent clients.

## Scope

1. Add `POST /api/v1/responses` endpoint with tool execution compatibility mapping.
2. Map run lifecycle metadata into response payload without losing `run_id`.
3. Ensure idempotency behavior is preserved with `Idempotency-Key + source`.
4. Provide compatibility test fixtures for common request shapes.

## Files to Touch

1. `app/app/api/v1/responses/route.ts` (new)
2. `app/lib/server/tool-executor.ts`
3. `app/lib/server/run-registry.ts`
4. `app/scripts/` (compat contract tests)

## Constraints

1. Do not break existing `/api/chat` and `/api/v1/execute` behavior.
2. Keep error schema explicit and machine-readable.
3. Maintain wait/cancel/event semantics for resulting `run_id`.

## Definition of Done

1. External client can call `/api/v1/responses` and receive executable result.
2. `run_id` can be queried via existing control-plane APIs.
3. Compatibility contract test passes for success and failure paths.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app test:contract
```

## Completion Notes (2026-02-25)

1. Implemented `POST /api/v1/responses` with OpenAI-style response envelope.
2. Added compatibility mapping for:
   `input` prompt extraction
   explicit `tool` + `params`
   `mode=sync|async`
3. Preserved `run_id` lifecycle and idempotency reuse via:
   `Idempotency-Key`
   tenant-scoped source keying.
4. Kept control-plane compatibility (`/api/runs/:id`, `wait`, `events`, `cancel`) through shared run registry semantics.
5. Added `test:contract:responses` and merged into `check:gate`.
