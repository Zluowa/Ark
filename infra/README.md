# Ark Infra Stack

PRD service stack foundation for local development:

1. PostgreSQL 16 (`127.0.0.1:35432`)
2. Redis 7 (`127.0.0.1:36379`)
3. MinIO S3-compatible object storage (`127.0.0.1:39000`, console `39001`)
4. Executor FastAPI (`127.0.0.1:38080`)

Reserved ports (`3000`, `4000`, `3004`, `3005`) are not used.

## Start

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

## Stop

```bash
docker compose -f infra/docker-compose.yml down
```

## Health Checks

1. `http://127.0.0.1:38080/healthz` (executor)
2. PostgreSQL: `postgresql://omniagent:omniagent@127.0.0.1:35432/omniagent`
3. Redis: `redis://127.0.0.1:36379`
4. MinIO console: `http://127.0.0.1:39001` (`minioadmin` / `minioadmin`)
