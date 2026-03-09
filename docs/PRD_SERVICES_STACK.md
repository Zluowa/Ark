# PRD Services Stack (Phase 1 Foundation)

Updated: 2026-02-25
Project root: repository root

## Target Mapping from PRD

1. Frontend/API: Next.js app (`app/`)
2. Python execution isolation: FastAPI executor (`services/executor-fastapi`)
3. Relational store: PostgreSQL 16
4. Cache/session: Redis 7
5. Artifact/object storage: MinIO (S3-compatible)
6. Sandbox execution: E2B (env placeholder prepared, integration pending)

## Local Stack Ports (reserved ports untouched)

1. App: `3010`
2. Executor FastAPI: `38080`
3. PostgreSQL: `35432`
4. Redis: `36379`
5. MinIO API: `39000`
6. MinIO Console: `39001`

## What Is Implemented

1. `infra/docker-compose.yml` boots PostgreSQL/Redis/MinIO/FastAPI executor.
2. Next tool execution path supports remote executor via `OMNIAGENT_EXECUTOR_BASE_URL`.
3. Existing `/api/v1/execute`, `/api/v1/execute/async`, `/api/v1/dispatch`, and `/api/v1/tools/[toolId]/test` routes work with remote executor.
4. Run lifecycle and event feed storage (`runs/events/idempotency`) persist in PostgreSQL (`omni_runs`, `omni_run_events`, `omni_run_idempotency`), with auto schema init.
5. Async tool jobs persist in Redis (`omniagent:job:*`) for cross-process-safe polling.
6. Tool artifacts persist to MinIO/S3 and API results return signed object URLs.

## Remaining Work

1. Replace placeholder tool logic with real PDF/image/video pipelines.
2. Integrate E2B runtime for sandboxed execution and quotas.
