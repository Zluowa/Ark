# AGENT-BE-01: Run Events (SSE)

## Mission

Implement run event streaming and replay-compatible event recording for control-plane visibility.

## Scope

1. Add `GET /api/runs/[id]/events` SSE endpoint.
2. Emit events for all run lifecycle transitions:
- `run.accepted`
- `run.running`
- `run.succeeded`
- `run.failed`
- `run.cancelled`
3. Emit periodic heartbeat events to keep SSE alive.
4. Support replay from last event id (`Last-Event-ID`) where possible.

## Files to Touch

1. `app/app/api/runs/[id]/events/route.ts` (new)
2. `app/lib/server/local-run-registry.ts`
3. `app/app/api/chat/route.ts`
4. `app/lib/api/control-plane.ts` (types only if needed)

## Constraints

1. No dependency on old gateway or `services/*`.
2. Keep port behavior unchanged (`3010` only in local dev).
3. Preserve existing `wait/cancel` behavior.

## Definition of Done

1. SSE endpoint returns `text/event-stream`.
2. Every run reaches terminal state with matching event sequence.
3. Consumer can subscribe and receive status updates without polling.
4. Existing smoke `smoke:chat-run` still passes.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:chat-run
```

