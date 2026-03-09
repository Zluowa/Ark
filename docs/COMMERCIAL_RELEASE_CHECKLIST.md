# Commercial Release Checklist

Updated: 2026-02-25

## 1. Product Readiness

1. Chat fast-dispatch UX can complete upload -> execute -> download flow.
2. Tools workbench supports upload, history, failure guidance.
3. Subagent API flows are visible and controllable.

## 2. Platform Readiness

1. `check:gate` is green in staging branch.
2. Contract tests include wait/cancel/idempotency/events/responses.
3. Usage and billing records are complete for all executions.

## 3. Reliability & SLO

1. API success rate (non-user error) >= 99.5% over 7 days.
2. Run terminal observability coverage >= 99%.
3. P95 wait completion after terminal <= 2s.

## 4. Security & Governance

1. API key scopes and tenant isolation verified.
2. Audit logs available for auth and execution actions.
3. Secrets policy and key rotation drill completed.

## 5. Release Operations

1. Staging soak test completed.
2. Rollback plan verified.
3. On-call owner and incident channel assigned.
