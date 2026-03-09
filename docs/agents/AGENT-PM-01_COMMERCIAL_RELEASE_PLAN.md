# AGENT-PM-01: Commercial Release Plan

## Mission

Turn current MVP baseline into an 8-week commercial release train with clear ownership, scope freeze, and go/no-go criteria.

## Scope

1. Define 4 release trains (2-week each): foundation, monetization, hardening, launch.
2. Freeze API contracts for commercial lanes (`auth/quota/billing/responses/subagent`).
3. Maintain dependency map and weekly risk register.
4. Define launch checklist for staging and production cutover.

## Deliverables

1. `docs/AGENT_EXECUTION_BOARD.md` sprint tracking kept up to date.
2. `docs/COMMERCIAL_RELEASE_CHECKLIST.md` (new).
3. Weekly status summary with blockers and ETA drift.

## Constraints

1. No scope creep into non-PRD features before launch.
2. Respect hard rules: no old gateway dependency, no reserved ports.
3. All lanes must stay mergeable behind feature flags when needed.

## Definition of Done

1. Every commercial lane has owner, ETA, dependency, and explicit DoD.
2. Release checklist exists and is testable by QA.
3. At least one dry-run release is completed in staging.

## Verification

1. Review `docs/AGENT_EXECUTION_BOARD.md` against active branch state.
2. Confirm all task files in `docs/agents` map to current lanes.
