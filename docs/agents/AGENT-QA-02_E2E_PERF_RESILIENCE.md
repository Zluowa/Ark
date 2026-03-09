# AGENT-QA-02: E2E, Performance, Resilience

## Mission

Create commercial release confidence with end-to-end validation, load profiling, and failure recovery drills.

## Scope

1. E2E scenarios for chat, tools sync/async, dispatch, uploads, and control-plane flows.
2. Performance suite for P50/P95 latency and throughput under realistic concurrency.
3. Resilience drills:
- service restart during active jobs
- SSE reconnect behavior
- idempotent replay after transient failures
4. Release gate report template for go/no-go decision.

## Files to Touch

1. `app/scripts/` (new e2e/perf/resilience scripts)
2. `app/package.json` (test commands and gate integration)
3. `docs/` (resilience runbook + results format)

## Constraints

1. Tests must run on project ports only (`3010`, `38080`, `35432`, `36379`, `39000`).
2. Keep deterministic fixtures for CI stability.
3. Failures must output actionable diagnostics.

## Definition of Done

1. E2E suite covers core commercial user journeys.
2. Performance baseline is captured and tracked.
3. Resilience drills pass and are repeatable.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app check:gate
```
