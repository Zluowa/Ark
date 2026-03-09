# Executor FastAPI Service

Standalone tool execution service for OmniAgent fast channel.

## Endpoints

1. `GET /healthz`
2. `GET /v1/tools`
3. `POST /v1/execute`

## Local Run

```bash
cd services/executor-fastapi
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 38080
```

## Docker Run

```bash
docker build -t omniagent-executor-fastapi .
docker run --rm -p 38080:8080 omniagent-executor-fastapi
```
