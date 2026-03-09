# AGENT-BE-02: Idempotency and Durable Run Store

## Mission

Make run lifecycle durable and idempotent according to PRD semantics.

## Scope

1. Implement idempotency reuse:
- same `Idempotency-Key + source` must return same `run_id`.
2. Replace pure in-memory run metadata with durable store abstraction.
3. Keep `wait` behavior side-effect free.
4. Record immutable `accepted_at`, `started_at`, `ended_at` lifecycle fields.

## Files to Touch

1. `app/lib/server/local-run-registry.ts` (or split into store + registry)
2. `app/app/api/chat/route.ts`
3. `app/app/api/runs/[id]/route.ts`
4. `app/app/api/runs/[id]/wait/route.ts`
5. `app/app/api/runs/[id]/cancel/route.ts`
6. `app/lib/server/env.ts` (if persistence env is needed)

## Data Model (Minimum)

1. Run: `run_id`, `status`, timestamps, error payload.
2. Idempotency index: `idempotency_key`, `source`, `run_id`.

## Constraints

1. Do not change relay key flow.
2. Do not introduce dependency on old project services.
3. Keep API response shape backward compatible for existing frontend.

## Definition of Done

1. Duplicate request with same idempotency tuple reuses original `run_id`.
2. Process restart does not lose active and recently completed run metadata.
3. `wait` returns final status without triggering cancel.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:chat-run
```

