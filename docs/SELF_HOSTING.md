# Self-Hosting Ark

This guide describes the public, reproducible setup for the repo.

## Stack Overview

Ark has three layers:

1. `desktop/island`
   Native Windows island shell
2. `app`
   Public website, dashboard, API routes, and tool orchestration
3. `desktop/launcher`
   Public desktop launcher that starts the island and hands dashboard access to the browser
4. `infra` plus `services/executor-fastapi`
   Optional persistence, artifact storage, and execution services

Product framing:

1. Island is the lightweight consumer surface
2. Web is the full consumer workspace
3. API is the enterprise and agent surface
4. All three share the same backend capability layer

## Minimal Local Mode

This is the fastest public-safe path:

1. Run `pnpm onboard --dry-run --profile web` if you want the checklist first
2. Run `pnpm onboard --yes --profile web`
3. Add an `OPENAI_API_KEY` or your own compatible gateway values
4. Run `pnpm --dir app dev`

This gives you the website and dashboard without durable infra.

## Full Local Mode

To enable persistent runs and local artifacts:

```bash
pnpm onboard --yes --profile full
pnpm --dir app dev
cargo run --manifest-path desktop/Cargo.toml -p omniagent-island
```

If you want an agent-friendly step-by-step guide, use [docs/AGENT_DEPLOYMENT.md](AGENT_DEPLOYMENT.md).

## Provider Setup

Open-source mode is BYOK today. Operators fill provider env values and issue deployment API keys for their own Ark instance.

This repo now also supports a local `managed_ark_key` mode for operator-run deployments. That mode can mint tenant-facing Ark keys, list and inspect managed tenants, show tenant usage, and rotate or revoke tenant-facing keys, but it is still not the future hosted SaaS billing/control plane.

### Chat And Image

Use one of:

1. `OPENAI_API_KEY`
2. Your own compatible gateway via `OMNIAGENT_RELAY_BASE_URL` and `OMNIAGENT_RELAY_API_KEY`

### Screen Analysis

Use one of:

1. `GEMINI_API_KEY`
2. `GOOGLE_API_KEY`

### Audio Transcription

Set:

1. `VOLCENGINE_APPID`
2. `VOLCENGINE_ACCESS_TOKEN`

### Optional Search

Set:

1. `TAVILY_API_KEY`

## Local Storage And Infra

When you want durable state, configure:

1. `DATABASE_URL`
2. `REDIS_URL`
3. `S3_ENDPOINT`
4. `S3_BUCKET`
5. `S3_ACCESS_KEY`
6. `S3_SECRET_KEY`

The included compose file exposes ports:

1. PostgreSQL: `35432`
2. Redis: `36379`
3. MinIO API: `39000`
4. MinIO console: `39001`
5. Executor FastAPI: `38080`

## Native Island Notes

The native island runtime currently targets Windows because it depends on Windows
media, capture, and shell APIs.

You can still run the website and API stack on other platforms.

The public default desktop build does not require a separate Tauri shell. Run the
website plus the island runtime, or use the launcher to start the island and then
open `http://127.0.0.1:3010/dashboard`.

## Publish Safely

Before making the repo public:

1. Keep `app/.env.local` untracked
2. Keep any `.omniagent-state` directory untracked
3. Review local screenshots for secrets and cookies
4. Verify `NEXT_PUBLIC_OMNIAGENT_GITHUB_URL` points to your public repository
