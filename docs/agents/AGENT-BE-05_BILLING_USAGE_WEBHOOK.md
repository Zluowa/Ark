# AGENT-BE-05: Billing, Usage, Webhook

## Mission

Build usage metering and billing event delivery so commercial customers can reconcile execution cost and automate downstream flows.

## Scope

1. Usage ledger per run/job (`credits_used`, tenant, tool, duration, status).
2. Billing counters by period (daily + monthly rollups).
3. Webhook dispatch for async completion (`job.completed`, `job.failed`) with signature header.
4. Retry + dead-letter policy for webhook failures.

## Files to Touch

1. `app/lib/server/run-registry.ts`
2. `app/lib/server/job-registry.ts`
3. `app/app/api/v1/execute*/route.ts`
4. `app/app/api/v1/dispatch/route.ts`
5. `app/lib/server/` (new billing + webhook service)

## Constraints

1. Failed executions should follow PRD charging policy.
2. Signature verification format must be documented and stable.
3. Webhook retries must be idempotent and bounded.

## Definition of Done

1. Every execution writes a usage record.
2. Webhook emits and retries with deterministic signature.
3. Billing summary endpoint/report is available for QA.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:tools-async
pnpm --dir app test:contract
```

## Completion Notes (2026-02-25)

1. Added usage ledger service with local/postgres backends and per-run/job metering fields.
2. Added billing summary/report APIs:
   `GET /api/v1/billing/summary`
   `GET /api/v1/billing/usage`
3. Integrated metering into `execute`, `execute async`, `dispatch sync/async`, `tools test`.
4. Added webhook dispatcher for async terminal events with:
   deterministic event id
   HMAC signature header (`x-omni-signature`)
   bounded retries + dead-letter persistence.
5. Added `test:contract:billing` and wired into `check:gate`.
