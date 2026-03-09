# AGENT-QA-01: Contract Tests and CI Gate

## Mission

Create stable control-plane contract checks and make them merge blockers.

## Scope

1. Add contract tests for:
- `wait` has no cancel side effects.
- idempotency tuple reuse returns same `run_id`.
- events stream includes accepted->terminal coverage.
2. Keep smoke chat-run and extend with contract script entry.
3. Wire scripts into CI gate command chain.

## Files to Touch

1. `app/scripts/` (add contract scripts)
2. `app/package.json` (add `test:contract` or `smoke:contract`)
3. `package.json` (workspace-level proxy scripts)
4. `docs/` (brief test runbook if needed)

## Constraints

1. Tests must run with local app on `3010`.
2. No assumptions about ports `3000/4000/3004/3005`.
3. No dependencies on unavailable old gateway services.

## Definition of Done

1. One command can validate control-plane minimum contract.
2. Failure output points to violated semantic rule.
3. Existing smoke remains green.
4. `check:gate` can be used as CI merge blocker entrypoint.

## Verification

```bash
pnpm --dir app lint
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir app smoke:chat-run
pnpm --dir app test:contract
pnpm --dir app check:gate
```
