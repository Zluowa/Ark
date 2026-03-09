# Ark

Open-source Dynamic Island tooling for capture, AI workflows, files, and a self-hosted operator console.

Ark combines three pieces in one repo:

1. A native Windows Dynamic Island surface built in Rust
2. A Next.js web console and public landing site
3. Local-first services for files, jobs, and optional AI-powered capture workflows

The project is designed to be reproducible by anyone. No hosted project key is bundled. Bring your own provider keys, or connect your own compatible gateway.

## Why This Repo Exists

Ark is built for fast, low-friction actions:

1. Capture audio and screen from the island
2. Resume files and tool flows without reopening a full dashboard
3. Hand results back to AI for summarization or further work
4. Run the same stack locally with your own models, APIs, and storage

## What Ships Here

1. `desktop/island`
   Windows-native Dynamic Island runtime, capture controls, file actions, music, focus, and tool surfaces
2. `app`
   Official website, operator dashboard, tool workbench, API routes, and self-hosted control plane entry
3. `infra/docker-compose.yml`
   Optional local infra for PostgreSQL, Redis, MinIO, and executor runtime
4. `services/executor-fastapi`
   Optional execution and artifact service used by the app stack

## Quickstart

### Prerequisites

1. Node.js 22+
2. pnpm 10+
3. Rust stable
4. Docker Desktop or compatible Docker engine
5. Windows 11 for the native island runtime

### 1. Clone And Install

```bash
git clone https://github.com/Zluowa/Ark.git
cd Ark
pnpm --dir app install
```

### 2. Configure Your Own Keys

```bash
cp app/.env.example app/.env.local
```

Then fill in only the providers you plan to use. Typical setups are:

1. Chat and image generation: `OPENAI_API_KEY` or your own compatible gateway via `OMNIAGENT_RELAY_BASE_URL` + `OMNIAGENT_RELAY_API_KEY`
2. Screen analysis: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
3. Audio transcription: `VOLCENGINE_APPID` + `VOLCENGINE_ACCESS_TOKEN`
4. Web search: `TAVILY_API_KEY`

All values are BYOK placeholders. No public example in this repo contains a real key.

### 3. Start Optional Infra

```bash
docker compose -f infra/docker-compose.yml up -d
```

This brings up:

1. PostgreSQL on `35432`
2. Redis on `36379`
3. MinIO on `39000`
4. Executor FastAPI on `38080`

### 4. Start The Web Console

```bash
pnpm --dir app dev
```

Open `http://127.0.0.1:3010`.

### 5. Start The Native Island

```bash
cargo run --manifest-path desktop/Cargo.toml -p omniagent-island
```

## Self-Hosting Model

Ark is intentionally open and modular:

1. Run the website alone
2. Run the website plus local infra
3. Run the website plus native island
4. Swap providers and endpoints without changing the public contract

Detailed setup lives in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Bring Your Own Keys

This repository is public-safe by design:

1. No real API keys are committed
2. No private relay URL is required
3. No unrelated private project references are needed to boot the stack
4. Credential storage is local-first

If you publish the repo, do not replace placeholders with live keys. Keep secrets in your own environment or secret manager.

## GitHub Readiness

The repo includes:

1. `LICENSE`
2. `CONTRIBUTING.md`
3. `CODE_OF_CONDUCT.md`
4. `SECURITY.md`
5. `.github/ISSUE_TEMPLATE`
6. `.github/workflows/ci.yml`

That is enough to push the project to GitHub without a cleanup pass.

## Development Commands

```bash
pnpm --dir app typecheck
pnpm --dir app build
node scripts/check-task-delivery.mjs
node scripts/check-task-delivery.mjs --require-ui
```

## Architecture

1. `app` exposes the public website, dashboard, API routes, and tool orchestration
2. `desktop/island` renders the native shell and dispatches local actions
3. `services/executor-fastapi` handles optional execution and artifact workflows
4. `infra/docker-compose.yml` provides reproducible local dependencies

## Publish Checklist

Before creating a public GitHub repository:

1. Review `app/.env.example`
2. Confirm no `.env.local` or local state files are tracked
3. Verify the website at `/` matches your public project name and links
4. Set `NEXT_PUBLIC_OMNIAGENT_GITHUB_URL` to your repository URL
5. Push the repo and enable the included CI workflow

## Community

1. Usage questions and ideas: open a GitHub Discussion or issue in your fork
2. Security issues: follow [SECURITY.md](SECURITY.md)
3. Contributions: follow [CONTRIBUTING.md](CONTRIBUTING.md)
