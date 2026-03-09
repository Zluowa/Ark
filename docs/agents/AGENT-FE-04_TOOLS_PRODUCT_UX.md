# AGENT-FE-04: Tools Product UX

## Mission

Make `/tools` commercial-ready for operations and customer support: clear history, audit context, and stable execution workflows.

## Scope

1. Add execution history list (recent runs/jobs with status + quick re-run).
2. Add upload UX polish (multi-file guidance, expired link handling).
3. Show billing/credit hint and tenant scope labels where applicable.
4. Add empty/error/skeleton states and copy improvements.

## Files to Touch

1. `app/app/tools/page.tsx`
2. `app/components/tools/tools-workbench.tsx`
3. `app/lib/api/tooling.ts`
4. `app/app/globals.css` (only if needed for clarity)

## Constraints

1. Do not rebuild chat infra; only improve tools product experience.
2. Keep interaction latency low and avoid unnecessary polling.
3. Maintain compatibility with current API contracts.

## Definition of Done

1. Operator can inspect recent runs and quickly reproduce failures.
2. File upload and output retrieval path is robust and understandable.
3. UX regression smoke passes with `smoke:ux`.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:tools-all
pnpm --dir app smoke:tools-async
pnpm --dir app smoke:ux
```
