# AGENT-INFRA-04: Observability and SLO

## Mission

Establish production-grade observability and SLO enforcement for commercial operations.

## Scope

1. Structured logs for request, run lifecycle, tool execution, and webhook delivery.
2. Metrics for latency, success rate, retry rate, and queue depth.
3. SLO dashboard aligned with PRD targets (`run coverage`, `wait latency`, `API success`).
4. Alerting policy with severity levels and response owner mapping.

## Files to Touch

1. `infra/docker-compose.yml` (local observability stack if needed)
2. `app/lib/server/**` (instrumentation hooks)
3. `app/docs/` (runbook and SLO definitions)
4. `app/scripts/` (health and resilience checks)

## Constraints

1. Avoid adding heavyweight dependencies without measurable value.
2. Keep local developer setup one-command reproducible.
3. Instrumentation must not change business semantics.

## Definition of Done

1. Key SLO metrics visible in one dashboard/runbook.
2. Alert simulation verifies routing and signal quality.
3. Failure diagnosis path documented for on-call.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app check:gate
```
