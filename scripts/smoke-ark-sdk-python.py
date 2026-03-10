import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sdk" / "python"))

from ark_sdk import ArkClient  # noqa: E402


def main() -> None:
    base_url = (
        os.environ.get("ARK_BASE_URL")
        or os.environ.get("OMNIAGENT_APP_BASE_URL")
        or "http://127.0.0.1:3010"
    )
    api_key = os.environ.get("ARK_API_KEY") or os.environ.get("OMNIAGENT_API_KEY")
    expect_keys = os.environ.get("ARK_EXPECT_KEYS") == "1" or os.environ.get("ARK_EXPECT_ADMIN") == "1"
    expect_tenants = os.environ.get("ARK_EXPECT_TENANTS") == "1" or os.environ.get("ARK_EXPECT_ADMIN") == "1"
    expect_managed = os.environ.get("ARK_EXPECT_MANAGED") == "1"
    client = ArkClient(base_url=base_url, api_key=api_key)

    platform = client.get_platform()
    if platform.get("brand", {}).get("name") != "Ark":
        raise RuntimeError("platform.brand.name should be Ark")

    tools = client.list_tools()
    if int(tools.get("total", 0)) <= 0:
        raise RuntimeError("tools.total should be > 0")

    if expect_keys:
        keys = client.list_api_keys()
        if int(keys.get("total", 0)) <= 0:
            raise RuntimeError("list_api_keys should return at least one key")
    if expect_tenants:
        tenants = client.list_tenants()
        if int(tenants.get("total", 0)) <= 0:
            raise RuntimeError("list_tenants should return at least one tenant")
    if expect_managed:
        managed_tenant_id = os.environ.get("ARK_MANAGED_TENANT_ID") or f"sdk-managed-tenant-{os.getpid()}"
        managed_list = client.list_managed_tenants()
        if managed_list.get("ok") is not True:
            raise RuntimeError("list_managed_tenants should succeed")
        managed = client.create_managed_tenant(
            id=managed_tenant_id,
            name="SDK Managed Tenant",
            quota={
                "burstPerMinute": 12,
                "concurrencyLimit": 2,
                "monthlyLimit": 120,
            },
        )
        if managed.get("service_mode") != "managed_ark_key":
            raise RuntimeError("create_managed_tenant should return managed_ark_key mode")
        tenant_api_key = managed.get("tenant_api_key")
        if not isinstance(tenant_api_key, str) or not tenant_api_key:
            raise RuntimeError("create_managed_tenant should return tenant_api_key")
        managed_detail = client.get_managed_tenant(managed_tenant_id, limit=5)
        if managed_detail.get("tenant", {}).get("id") != managed_tenant_id:
            raise RuntimeError("get_managed_tenant should return requested tenant")
        managed_key = client.create_managed_tenant_key(managed_tenant_id)
        managed_key_secret = managed_key.get("tenant_api_key")
        managed_key_id = managed_key.get("tenant_key", {}).get("id")
        if not isinstance(managed_key_secret, str) or not managed_key_secret:
            raise RuntimeError("create_managed_tenant_key should return tenant_api_key")
        if not isinstance(managed_key_id, str) or not managed_key_id:
            raise RuntimeError("create_managed_tenant_key should return tenant key id")
        revoked_key = client.revoke_managed_tenant_key(managed_tenant_id, managed_key_id)
        if revoked_key.get("tenant_key", {}).get("status") != "revoked":
            raise RuntimeError("revoke_managed_tenant_key should revoke key")

    execution = client.execute(
        "convert.json_format",
        {"input": "{\"ok\": true}", "mode": "pretty"},
    )
    if execution.get("status") != "success":
        raise RuntimeError("sync execute should succeed")

    async_execution = client.execute_async(
        "convert.json_format",
        {"input": "{\"async\": true}", "mode": "minify"},
    )
    job_id = async_execution.get("job_id")
    if not isinstance(job_id, str) or not job_id:
        raise RuntimeError("async execute should return job_id")

    job = client.poll_job(job_id, interval_s=0.25, timeout_s=15.0)
    if job.get("status") != "completed":
        raise RuntimeError("async job should complete")

    print(
        json.dumps(
            {
                "ok": True,
                "baseUrl": base_url,
                "expectKeys": expect_keys,
                "expectTenants": expect_tenants,
                "expectManaged": expect_managed,
                "usedApiKey": bool(api_key),
                "toolTotal": tools.get("total"),
                "jobStatus": job.get("status"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
