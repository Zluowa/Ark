from __future__ import annotations

import json
import mimetypes
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


class ArkApiError(RuntimeError):
    def __init__(
        self,
        status: int,
        message: str,
        code: str | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


class ArkClient:
    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        timeout: float = 30.0,
        user_agent: str = "ark-python-sdk/0.1.0",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip() if api_key else None
        self.timeout = timeout
        self.user_agent = user_agent
        parsed = urllib.parse.urlparse(self.base_url)
        self._disable_proxy = (parsed.hostname or "").lower() in LOCAL_HOSTS

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "ArkClient":
        source = env or os.environ
        return cls(
            base_url=source.get("ARK_BASE_URL")
            or source.get("OMNIAGENT_APP_BASE_URL")
            or "http://127.0.0.1:3010",
            api_key=source.get("ARK_API_KEY") or source.get("OMNIAGENT_API_KEY"),
        )

    def get_platform(self) -> dict[str, Any]:
        return self._request_json("GET", "/api/v1/platform", auth=False)

    def list_tools(self) -> dict[str, Any]:
        return self._request_json("GET", "/api/v1/tools/registry", auth=False)

    def execute(self, tool: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request_json(
            "POST",
            "/api/v1/execute",
            json_body={"tool": tool, "params": params or {}},
        )

    def execute_async(
        self,
        tool: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._request_json(
            "POST",
            "/api/v1/execute/async",
            json_body={"tool": tool, "params": params or {}},
        )

    def get_job(self, job_id: str) -> dict[str, Any]:
        safe_job_id = urllib.parse.quote(job_id, safe="")
        return self._request_json("GET", f"/api/v1/jobs/{safe_job_id}")

    def poll_job(
        self,
        job_id: str,
        interval_s: float = 1.0,
        timeout_s: float = 60.0,
    ) -> dict[str, Any]:
        started = time.monotonic()
        while True:
            job = self.get_job(job_id)
            status = job.get("status")
            if status in {"completed", "failed", "cancelled"}:
                return job
            if time.monotonic() - started > timeout_s:
                raise ArkApiError(408, f"Timed out waiting for job {job_id}", "job_poll_timeout")
            time.sleep(interval_s)

    def upload_file(
        self,
        path: str | Path,
        *,
        scope: str = "user_input",
        field_name: str = "file",
        content_type: str | None = None,
    ) -> dict[str, Any]:
        file_path = Path(path)
        data = file_path.read_bytes()
        mime = content_type or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        boundary = f"----ArkBoundary{uuid.uuid4().hex}"
        body = self._encode_multipart(
            boundary=boundary,
            field_name=field_name,
            file_name=file_path.name,
            content_type=mime,
            data=data,
            scope=scope,
        )
        return self._request_json(
            "POST",
            "/api/v1/files",
            body=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )

    def list_api_keys(self, tenant_id: str | None = None) -> dict[str, Any]:
        query = ""
        if tenant_id:
            query = f"?tenant_id={urllib.parse.quote(tenant_id, safe='')}"
        return self._request_json("GET", f"/api/v1/admin/api-keys{query}")

    def create_api_key(
        self,
        *,
        tenant_id: str | None = None,
        scopes: list[str] | None = None,
        id: str | None = None,
        key: str | None = None,
        quota: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if tenant_id:
            body["tenant_id"] = tenant_id
        if scopes is not None:
            body["scopes"] = scopes
        if id:
            body["id"] = id
        if key:
            body["key"] = key
        if quota is not None:
            body["quota"] = quota
        return self._request_json("POST", "/api/v1/admin/api-keys", json_body=body)

    def revoke_api_key(self, key_id: str) -> dict[str, Any]:
        safe_key_id = urllib.parse.quote(key_id, safe="")
        return self._request_json("DELETE", f"/api/v1/admin/api-keys/{safe_key_id}")

    def list_tenants(self) -> dict[str, Any]:
        return self._request_json("GET", "/api/v1/admin/tenants")

    def create_tenant(
        self,
        *,
        id: str,
        name: str | None = None,
        quota: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"id": id}
        if name:
            body["name"] = name
        if quota is not None:
            body["quota"] = quota
        return self._request_json("POST", "/api/v1/admin/tenants", json_body=body)

    def create_managed_tenant(
        self,
        *,
        id: str,
        name: str | None = None,
        quota: dict[str, Any] | None = None,
        tenant_key_id: str | None = None,
        tenant_key_scopes: list[str] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"id": id}
        if name:
          body["name"] = name
        if quota is not None:
          body["quota"] = quota
        if tenant_key_id:
          body["tenant_key_id"] = tenant_key_id
        if tenant_key_scopes is not None:
          body["tenant_key_scopes"] = tenant_key_scopes
        return self._request_json("POST", "/api/v1/admin/managed-tenants", json_body=body)

    def list_managed_tenants(self) -> dict[str, Any]:
        return self._request_json("GET", "/api/v1/admin/managed-tenants")

    def get_managed_tenant(
        self,
        tenant_id: str,
        *,
        limit: int | None = None,
    ) -> dict[str, Any]:
        safe_tenant_id = urllib.parse.quote(tenant_id, safe="")
        query = ""
        if limit is not None:
            bounded = max(1, min(500, int(limit)))
            query = f"?limit={bounded}"
        return self._request_json(
            "GET",
            f"/api/v1/admin/managed-tenants/{safe_tenant_id}{query}",
        )

    def update_managed_tenant(
        self,
        tenant_id: str,
        *,
        name: str | None = None,
        quota: dict[str, Any] | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        safe_tenant_id = urllib.parse.quote(tenant_id, safe="")
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if quota is not None:
            body["quota"] = quota
        if status is not None:
            body["status"] = status
        return self._request_json(
            "PATCH",
            f"/api/v1/admin/managed-tenants/{safe_tenant_id}",
            json_body=body,
        )

    def create_managed_tenant_key(
        self,
        tenant_id: str,
        *,
        id: str | None = None,
        key: str | None = None,
        quota: dict[str, Any] | None = None,
        scopes: list[str] | None = None,
        revoke_existing: bool = False,
    ) -> dict[str, Any]:
        safe_tenant_id = urllib.parse.quote(tenant_id, safe="")
        body: dict[str, Any] = {}
        if id:
            body["id"] = id
        if key:
            body["key"] = key
        if quota is not None:
            body["quota"] = quota
        if scopes is not None:
            body["scopes"] = scopes
        if revoke_existing:
            body["revoke_existing"] = True
        return self._request_json(
            "POST",
            f"/api/v1/admin/managed-tenants/{safe_tenant_id}/keys",
            json_body=body,
        )

    def revoke_managed_tenant_key(self, tenant_id: str, key_id: str) -> dict[str, Any]:
        safe_tenant_id = urllib.parse.quote(tenant_id, safe="")
        safe_key_id = urllib.parse.quote(key_id, safe="")
        return self._request_json(
            "DELETE",
            f"/api/v1/admin/managed-tenants/{safe_tenant_id}/keys/{safe_key_id}",
        )

    def get_tenant(self, tenant_id: str) -> dict[str, Any]:
        safe_tenant_id = urllib.parse.quote(tenant_id, safe="")
        return self._request_json("GET", f"/api/v1/admin/tenants/{safe_tenant_id}")

    def update_tenant(
        self,
        tenant_id: str,
        *,
        name: str | None = None,
        quota: dict[str, Any] | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        safe_tenant_id = urllib.parse.quote(tenant_id, safe="")
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if quota is not None:
            body["quota"] = quota
        if status is not None:
            body["status"] = status
        return self._request_json("PATCH", f"/api/v1/admin/tenants/{safe_tenant_id}", json_body=body)

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        auth: bool = True,
        json_body: dict[str, Any] | None = None,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        merged_headers = {
            "Accept": "application/json",
            "X-Ark-Client": self.user_agent,
        }
        if headers:
            merged_headers.update(headers)
        payload = body
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            merged_headers["Content-Type"] = "application/json"
        if auth and self.api_key:
            merged_headers["X-API-Key"] = self.api_key

        request = urllib.request.Request(
            url=f"{self.base_url}{path}",
            data=payload,
            headers=merged_headers,
            method=method,
        )
        try:
            if self._disable_proxy:
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                response = opener.open(request, timeout=self.timeout)
            else:
                response = urllib.request.urlopen(request, timeout=self.timeout)
            with response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {}
            error = parsed.get("error") if isinstance(parsed, dict) else {}
            if not isinstance(error, dict):
                error = {}
            raise ArkApiError(
                exc.code,
                str(error.get("message") or exc.reason),
                str(error.get("code")) if error.get("code") else None,
                error.get("details"),
            ) from exc

    def _encode_multipart(
        self,
        *,
        boundary: str,
        field_name: str,
        file_name: str,
        content_type: str,
        data: bytes,
        scope: str,
    ) -> bytes:
        lines: list[bytes] = []
        boundary_bytes = boundary.encode("utf-8")
        lines.extend(
            [
                b"--" + boundary_bytes,
                b'Content-Disposition: form-data; name="scope"',
                b"",
                scope.encode("utf-8"),
                b"--" + boundary_bytes,
                (
                    f'Content-Disposition: form-data; name="{field_name}"; filename="{file_name}"'
                ).encode("utf-8"),
                f"Content-Type: {content_type}".encode("utf-8"),
                b"",
                data,
                b"--" + boundary_bytes + b"--",
                b"",
            ]
        )
        return b"\r\n".join(lines)
