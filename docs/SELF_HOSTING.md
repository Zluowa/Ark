# Self-Hosting Ark

This guide describes the public, reproducible setup for the repo.

## Stack Overview

Ark has three layers:

1. `app`
   Public website, dashboard, API routes, and tool orchestration
2. `desktop/island`
   Native Windows island shell
3. `infra` plus `services/executor-fastapi`
   Optional persistence, artifact storage, and execution services

## Minimal Local Mode

This is the fastest public-safe path:

1. Copy `app/.env.example` to `app/.env.local`
2. Add an `OPENAI_API_KEY` or your own compatible gateway values
3. Run `pnpm --dir app install`
4. Run `pnpm --dir app dev`

This gives you the website and dashboard without durable infra.

## Full Local Mode

To enable persistent runs and local artifacts:

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm --dir app dev
cargo run --manifest-path desktop/Cargo.toml -p omniagent-island
```

## Provider Setup

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

## Publish Safely

Before making the repo public:

1. Keep `app/.env.local` untracked
2. Keep any `.omniagent-state` directory untracked
3. Review local screenshots for secrets and cookies
4. Verify `NEXT_PUBLIC_OMNIAGENT_GITHUB_URL` points to your public repository
