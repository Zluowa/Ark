# Agent Deployment Guide

This guide is for coding agents or operators using a coding agent to deploy Ark from a fresh clone.

## Fastest Path

Use the onboarding command from the repository root:

```bash
pnpm onboard --yes --profile full
```

Profiles:

1. `web`
   Website and dashboard only
2. `native`
   Website plus the native island runtime
3. `full`
   Website, optional local infra, and native island guidance

If you only want the checklist without making changes:

```bash
pnpm onboard --dry-run --profile full
```

## What The Onboard Command Does

1. Copies `app/.env.example` to `app/.env.local` when missing
2. Prints the exact commands for the selected deployment profile
3. Installs `app` dependencies when `--yes` is present
4. Starts Compose infra for the `full` profile
5. Leaves long-running dev servers and the native island launch under explicit operator control

## Provider Checklist

Before launch, fill only the providers you actually need:

1. `OPENAI_API_KEY` or your compatible gateway values
2. `GEMINI_API_KEY` or `GOOGLE_API_KEY`
3. `VOLCENGINE_APPID` and `VOLCENGINE_ACCESS_TOKEN`
4. `TAVILY_API_KEY` when web search is needed

## Manual Verification

After onboarding:

1. Start the site with `pnpm --dir app dev`
2. Verify `http://127.0.0.1:3010`
3. Verify `http://127.0.0.1:3010/dashboard`
4. On Windows, start the native island with `cargo run --manifest-path desktop/Cargo.toml -p omniagent-island`

## Agent Acceptance Checklist

An implementation agent should finish with:

1. `pnpm --dir app typecheck`
2. `pnpm --dir app build`
3. `cargo test --manifest-path desktop/Cargo.toml -p omniagent-island -j 1`
4. `node scripts/check-task-delivery.mjs`
5. `node scripts/check-task-delivery.mjs --require-ui`

## Public Desktop Contract

The default public desktop path is:

1. web app on `http://127.0.0.1:3010`
2. native island via `cargo run --manifest-path desktop/Cargo.toml -p omniagent-island`
3. optional launcher via `cargo run --manifest-path desktop/Cargo.toml -p omniagent-launcher`

The launcher starts the island and hands the dashboard off to the browser. The
public default branch does not require a separate Tauri shell.
