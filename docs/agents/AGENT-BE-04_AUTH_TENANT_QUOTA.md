# AGENT-BE-04: Auth, Tenant, Quota

## Mission

Implement commercial-grade access control for B2B API usage with strict tenant isolation and quota governance.

## Scope

1. API key model with scopes (`execute:read`, `execute:write`, `runs:read`, `admin:*`).
2. Tenant boundary enforcement on all `/api/v1/*` and run resources.
3. Quota checks before execution (`monthly`, `burst`, `concurrency`).
4. Standardized auth and quota error codes.

## Files to Touch

1. `app/app/api/v1/**/route.ts`
2. `app/lib/server/run-registry.ts`
3. `app/lib/server/job-registry.ts`
4. `app/lib/server/env.ts` (tenant/quota config)
5. `app/scripts/` (auth+quota contract tests)

## Constraints

1. Default deny for missing/invalid credentials.
2. Keep C-end chat path available with explicit trusted local mode.
3. No breaking changes to existing smoke flows without compatibility shim.

## Definition of Done

1. Scope denial and quota denial are deterministic and auditable.
2. Cross-tenant resource access is blocked.
3. Contract tests cover allow/deny and quota exhaustion behavior.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app test:contract
```

## Completion Notes (2026-02-25)

1. Implemented API key scope enforcement on `/api/v1/*` and `/api/runs/*`.
2. Added trusted-local compatibility mode for local chat/tool smoke flows.
3. Added tenant ownership fields to run/job registries and cross-tenant access blocking.
4. Added execution quota governor (`monthly`, `burst`, `concurrency`) with standardized `429 quota_*` errors.
5. Added `scripts/contract-auth-quota.mjs` and wired it into `check:gate`.
