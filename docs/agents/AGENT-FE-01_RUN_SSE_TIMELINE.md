# AGENT-FE-01: Run SSE Timeline UI

## Mission

Upgrade frontend run status from polling-first to SSE-first with clear timeline visibility.

## Scope

1. Add SSE subscription client for `/api/runs/{id}/events`.
2. Build timeline panel with ordered events and timestamps.
3. Keep fallback polling for disconnected SSE.
4. Preserve existing run actions: refresh, wait, cancel.

## Files to Touch

1. `app/hooks/use-run-status.ts`
2. `app/components/assistant-ui/run-status-panel.tsx`
3. `app/lib/api/control-plane.ts`
4. `app/components/assistant-ui/thread.tsx` (only if UI wiring needed)

## UX Requirements

1. Show lifecycle badges: accepted/running/succeeded/failed/cancelled.
2. Show last event time and connection state (`live`, `reconnecting`, `offline`).
3. Show error payload when terminal is `failed`.

## Constraints

1. Keep assistant-ui primitives; no full custom chat rewrite.
2. No cross-project imports.
3. Keep mobile and desktop usable.

## Definition of Done

1. New runs update in near real-time from SSE.
2. If SSE disconnects, polling fallback keeps status correct.
3. UI remains functional when events endpoint is unavailable.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:chat-run
```

