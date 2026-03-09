# AGENT-BE-07: Subagent GA Control Plane

## Mission

Move subagent controls from concept to GA-ready API with lineage tracking and operational safety.

## Scope

1. Implement `/api/v1/subagents/spawn`, `/api/v1/subagents`, `/api/v1/subagents/{id}`.
2. Implement `/wait` and `/cancel` for subagents.
3. Persist immutable lineage fields: `spawned_by`, `spawn_depth`.
4. Enforce inherited policy with lower-privilege override only.

## Files to Touch

1. `app/app/api/v1/subagents/**/route.ts` (new)
2. `app/lib/server/run-registry.ts`
3. `app/lib/server/` (subagent service/state)
4. `app/scripts/` (subagent contract tests)

## Constraints

1. No privilege escalation from child agent.
2. Lineage fields are append-only and immutable after write.
3. Subagent run events must reuse existing events pipeline.

## Definition of Done

1. Subagent lifecycle can be queried and cancelled safely.
2. Lineage is visible and replayable for audit.
3. Contract tests validate immutability and policy inheritance.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app test:contract
```

## Completion Notes (2026-02-25)

1. Implemented subagent GA routes:
   `POST /api/v1/subagents/spawn`
   `GET /api/v1/subagents`
   `GET /api/v1/subagents/{id}`
   `GET /api/v1/subagents/{id}/wait`
   `POST /api/v1/subagents/{id}/cancel`
2. Added immutable lineage persistence in run state and subagent state:
   `spawned_by`
   `spawn_depth`
3. Enforced inherited policy for child scopes:
   default inherit parent scopes
   allow lower-privilege requested scopes
   deny privilege escalation and deny child spawn when parent lacks `execute:write`
4. Reused existing run control-plane semantics and event pipeline (`/api/runs/{id}`, `/wait`, `/events`, `/cancel`) by binding each subagent to a run record.
5. Added `test:contract:subagents` and merged into `check:gate`.
