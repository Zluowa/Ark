# AGENT-SEC-01: Security and Compliance Hardening

## Mission

Raise platform security posture to commercial baseline with enforceable controls and auditable practices.

## Scope

1. Secret handling policy (env, logs, CI masking, rotation workflow).
2. API abuse controls (rate limit, input validation, payload limits).
3. Audit logging requirements for auth, execution, and admin operations.
4. Threat checklist for tenant isolation, artifact access, webhook spoofing.

## Files to Touch

1. `app/lib/server/env.ts`
2. `app/app/api/**/route.ts`
3. `app/lib/server/**` (auth, validation, audit hooks)
4. `docs/` (security checklist + incident response notes)

## Constraints

1. No plaintext secrets in repository.
2. Security controls must be testable and not purely declarative.
3. Keep compatibility with existing developer flow.

## Definition of Done

1. Security checklist completed with owner sign-off.
2. Critical issues have automated regression tests.
3. Artifact and webhook access controls are verified.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app test:contract
```
