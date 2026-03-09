# Contributing

Thanks for contributing to OmniAgent Island.

## Ground Rules

1. Keep all new examples public-safe. Never commit live keys, cookies, or private endpoints.
2. Prefer self-hosted, reproducible setup instructions over local tribal knowledge.
3. If you change UI, include screenshots and note any visual regressions.
4. Keep changes scoped. Do not mix unrelated feature work into one pull request.

## Local Setup

1. Install Node.js 22+, pnpm 10+, Rust stable, and Docker.
2. Copy `app/.env.example` to `app/.env.local`.
3. Start infra with `docker compose -f infra/docker-compose.yml up -d`.
4. Run the web app with `pnpm --dir app dev`.
5. Run the island with `cargo run --manifest-path desktop/Cargo.toml -p omniagent-island`.

## Pull Requests

Every pull request should include:

1. A short problem statement
2. The approach taken
3. Test results
4. UI evidence when relevant
5. Any new environment variables added to `app/.env.example`

## Quality Checks

Run the relevant checks before opening a pull request:

```bash
pnpm --dir app typecheck
pnpm --dir app build
cargo test --manifest-path desktop/Cargo.toml -p omniagent-island -j 1
node scripts/check-task-delivery.mjs
```

## Design Bar

Public-facing UI should:

1. Explain the product quickly
2. Preserve the existing island visual language
3. Avoid placeholder-grade layouts
4. Stay usable on desktop and mobile
