import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const root = process.cwd();
const envFile = resolve(root, ".moss/managed-ark-key-smoke.env");
const host = "127.0.0.1";
const reportDir = resolve(
  root,
  "app",
  "test-screenshots",
  "2026-03-10-managed-ark-key-proof",
);

const normalizeProxyUrl = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  const segments = trimmed
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const preferred =
    segments.find((segment) => /^https=/i.test(segment)) ||
    segments.find((segment) => /^http=/i.test(segment)) ||
    segments[0] ||
    "";
  const raw = preferred.includes("=") ? preferred.split("=").slice(1).join("=") : preferred;
  if (!raw) {
    return "";
  }
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
};

const detectWindowsProxy = () => {
  if (process.platform !== "win32") {
    return "";
  }
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "$settings = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) { [Console]::Out.Write($settings.ProxyServer) }",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
    },
  );
  if (result.status !== 0) {
    return "";
  }
  return normalizeProxyUrl(result.stdout);
};

const resolvedProxy =
  normalizeProxyUrl(process.env.MEDIA_PROXY) ||
  normalizeProxyUrl(process.env.HTTPS_PROXY) ||
  normalizeProxyUrl(process.env.HTTP_PROXY) ||
  detectWindowsProxy();

const baseEnv = {
  ...process.env,
  ...(resolvedProxy
    ? {
        MEDIA_PROXY: resolvedProxy,
        HTTPS_PROXY: resolvedProxy,
        HTTP_PROXY: resolvedProxy,
      }
    : {}),
};

const resolveCommand = (command, commandArgs) => {
  if (process.platform === "win32" && (command === "pnpm" || command === "pnpm.cmd")) {
    return {
      command: "cmd.exe",
      commandArgs: ["/c", "pnpm", ...commandArgs],
    };
  }
  return { command, commandArgs };
};

const run = (command, commandArgs, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const resolved = resolveCommand(command, commandArgs);
    const child = spawn(resolved.command, resolved.commandArgs, {
      cwd: root,
      env: options.env ?? baseEnv,
      stdio: options.stdio ?? "pipe",
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(
        new Error(
          `${resolved.command} ${resolved.commandArgs.join(" ")} failed (${code}): ${stderr || stdout}`,
        ),
      );
    });
  });

const parseEnvFile = (filePath) => {
  const entries = {};
  const source = readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }
    entries[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return entries;
};

const upsertEnvValue = (source, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (pattern.test(source)) {
    return source.replace(pattern, line);
  }
  return source.trimEnd() + `\n${line}\n`;
};

const sleep = async (ms) => {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
};

const killProcessTree = async (pid) => {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "pipe" }).catch(() => {});
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
  await sleep(500);
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
};

const reservePort = async (preferredPort = 3213) =>
  new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.on("error", () => {
      const fallback = createServer();
      fallback.unref();
      fallback.on("error", rejectPromise);
      fallback.listen(0, host, () => {
        const address = fallback.address();
        const port = typeof address === "object" && address ? address.port : 0;
        fallback.close(() => resolvePromise(port));
      });
    });
    server.listen(preferredPort, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : preferredPort;
      server.close(() => resolvePromise(port));
    });
  });

const waitForHealth = async (url, timeoutMs = 30000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`, { cache: "no-store" });
      if (res.ok) {
        return;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}/api/health`);
};

const requestJson = async (baseUrl, path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {}
  return { response, body };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  rmSync(reportDir, { recursive: true, force: true });
  mkdirSync(reportDir, { recursive: true });
  await run("pnpm", ["--dir", "app", "build"]);
  await run("pnpm", ["sdk:build:ts"]);
  const port = await reservePort();
  const baseUrl = `http://${host}:${port}`;

  const issueResult = await run(process.execPath, [
    resolve(root, "scripts/issue-local-api-key.mjs"),
    "--write",
    "--file",
    envFile,
    "--tenant",
    "managed-ark-operator",
    "--id",
    "managed-ark-operator-key",
    "--scopes",
    "admin:*,execute:read,execute:write,runs:read",
  ]);
  const issued = JSON.parse(issueResult.stdout);
  const source = readFileSync(envFile, "utf8");
  const nextEnv = upsertEnvValue(source, "OMNIAGENT_SERVICE_MODE", "managed_ark_key");
  writeFileSync(envFile, nextEnv, "utf8");
  const envFromFile = parseEnvFile(envFile);

  const serverCommand = resolveCommand("pnpm", [
    "--dir",
    "app",
    "exec",
    "next",
    "start",
    "-H",
    host,
    "-p",
    String(port),
  ]);
  const server = spawn(serverCommand.command, serverCommand.commandArgs, {
    cwd: root,
    env: {
      ...baseEnv,
      ...envFromFile,
    },
    stdio: "pipe",
  });

  let serverStdout = "";
  let serverStderr = "";
  let completedSuccessfully = false;
  server.stdout?.on("data", (chunk) => {
    serverStdout += chunk.toString();
  });
  server.stderr?.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });

  try {
    await waitForHealth(baseUrl);

    const platform = await requestJson(baseUrl, "/api/v1/platform");
    assert(platform.response.ok, "platform endpoint should succeed");

    const operatorHeaders = {
      "X-API-Key": issued.api_key,
      "Content-Type": "application/json",
    };
    const tenantId = `managed-tenant-${Date.now()}`;
    const created = await requestJson(baseUrl, "/api/v1/admin/managed-tenants", {
      method: "POST",
      headers: operatorHeaders,
      body: JSON.stringify({
        id: tenantId,
        name: "Managed Ark Smoke Tenant",
        quota: {
          burstPerMinute: 24,
          concurrencyLimit: 4,
          monthlyLimit: 240,
        },
      }),
    });
    assert(created.response.ok, "managed tenant creation should succeed");
    assert(created.body?.service_mode === "managed_ark_key", "managed service mode should be returned");
    assert(created.body?.tenant?.id === tenantId, "managed tenant id should match");
    assert(typeof created.body?.tenant_api_key === "string" && created.body.tenant_api_key, "tenant_api_key should be returned");

    const managedList = await requestJson(baseUrl, "/api/v1/admin/managed-tenants", {
      headers: {
        "X-API-Key": issued.api_key,
      },
    });
    assert(managedList.response.ok, "managed tenant listing should succeed");
    assert(
      Array.isArray(managedList.body?.tenants) &&
        managedList.body.tenants.some((item) => item?.tenant?.id === tenantId),
      "managed tenant should appear in managed listing",
    );

    const tenantApiKey = String(created.body.tenant_api_key);
    const tenantHeaders = {
      "X-API-Key": tenantApiKey,
      "Content-Type": "application/json",
    };

    const sdkManagedEnv = {
      ...process.env,
      ARK_BASE_URL: baseUrl,
      ARK_API_KEY: issued.api_key,
      ARK_EXPECT_MANAGED: "1",
    };
    await run("node", ["scripts/smoke-ark-sdk-ts.mjs"], {
      env: {
        ...sdkManagedEnv,
        ARK_MANAGED_TENANT_ID: `${tenantId}-sdk-ts`,
      },
    });
    await run("python", ["scripts/smoke-ark-sdk-python.py"], {
      env: {
        ...sdkManagedEnv,
        ARK_MANAGED_TENANT_ID: `${tenantId}-sdk-py`,
      },
    });

    const syncRun = await requestJson(baseUrl, "/api/v1/execute", {
      method: "POST",
      headers: tenantHeaders,
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"managed\":true}",
          mode: "pretty",
        },
      }),
    });
    assert(syncRun.response.ok, "managed tenant sync execute should succeed");
    assert(syncRun.body?.status === "success", "managed tenant sync execute should return success");

    const asyncRun = await requestJson(baseUrl, "/api/v1/execute/async", {
      method: "POST",
      headers: tenantHeaders,
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"managed_async\":true}",
          mode: "minify",
        },
      }),
    });
    assert(asyncRun.response.ok, "managed tenant async execute should succeed");
    const jobId = asyncRun.body?.job_id;
    assert(typeof jobId === "string" && jobId, "managed tenant async execute should return job_id");

    let jobStatus = "queued";
    for (let index = 0; index < 40; index += 1) {
      const job = await requestJson(baseUrl, `/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        headers: {
          "X-API-Key": tenantApiKey,
        },
      });
      assert(job.response.ok, "managed tenant job polling should succeed");
      jobStatus = String(job.body?.status ?? "");
      if (jobStatus === "completed") {
        break;
      }
      await sleep(250);
    }
    assert(jobStatus === "completed", `managed tenant job should complete, got ${jobStatus}`);

    const managedDetail = await requestJson(
      baseUrl,
      `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}?limit=20`,
      {
        headers: {
          "X-API-Key": issued.api_key,
        },
      },
    );
    assert(managedDetail.response.ok, "managed tenant detail should succeed");
    assert(
      managedDetail.body?.tenant?.id === tenantId,
      "managed tenant detail should return tenant",
    );
    assert(
      typeof managedDetail.body?.usage_summary?.month?.totalRuns === "number" &&
        managedDetail.body.usage_summary.month.totalRuns >= 2,
      "managed tenant detail should include usage summary",
    );
    assert(
      Array.isArray(managedDetail.body?.usage) &&
        managedDetail.body.usage.length >= 2,
      "managed tenant detail should include recent usage records",
    );

    const extraKey = await requestJson(
      baseUrl,
      `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}/keys`,
      {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({
          scopes: ["execute:read", "execute:write", "runs:read"],
        }),
      },
    );
    assert(extraKey.response.ok, "managed tenant key create should succeed");
    const extraTenantApiKey = String(extraKey.body?.tenant_api_key ?? "");
    const extraTenantKeyId = String(extraKey.body?.tenant_key?.id ?? "");
    assert(extraTenantApiKey, "managed tenant key create should return tenant_api_key");
    assert(extraTenantKeyId, "managed tenant key create should return tenant key id");

    const extraKeySync = await requestJson(baseUrl, "/api/v1/execute", {
      method: "POST",
      headers: {
        "X-API-Key": extraTenantApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"managed_extra\":true}",
          mode: "pretty",
        },
      }),
    });
    assert(extraKeySync.response.ok, "extra managed tenant key should execute sync tool");

    const revokedExtraKey = await requestJson(
      baseUrl,
      `/api/v1/admin/managed-tenants/${encodeURIComponent(tenantId)}/keys/${encodeURIComponent(extraTenantKeyId)}`,
      {
        method: "DELETE",
        headers: {
          "X-API-Key": issued.api_key,
        },
      },
    );
    assert(revokedExtraKey.response.ok, "managed tenant key revoke should succeed");
    assert(
      revokedExtraKey.body?.tenant_key?.status === "revoked",
      "managed tenant key revoke should return revoked key",
    );

    const revokedExtraDenied = await requestJson(baseUrl, "/api/v1/execute", {
      method: "POST",
      headers: {
        "X-API-Key": extraTenantApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"managed_revoked\":true}",
          mode: "pretty",
        },
      }),
    });
    assert(
      revokedExtraDenied.response.status === 401,
      "revoked managed tenant key should be denied immediately",
    );

    const serviceModeDenied = await requestJson(baseUrl, "/api/v1/admin/api-keys", {
      headers: {
        "X-API-Key": tenantApiKey,
      },
    });
    assert(serviceModeDenied.response.status === 403, "tenant Ark key should not get operator key-management access");

    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      baseUrl,
      serviceMode: created.body?.service_mode,
      operatorApiKeyId: issued.api_key_id,
      tenantId,
      tenantKeyId: created.body?.tenant_key?.id,
      rotatedTenantKeyId: extraTenantKeyId,
      jobStatus,
      monthRuns: managedDetail.body?.usage_summary?.month?.totalRuns ?? null,
      usageCount: Array.isArray(managedDetail.body?.usage)
        ? managedDetail.body.usage.length
        : null,
    };
    writeFileSync(
      join(reportDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(report, null, 2));
    completedSuccessfully = true;
  } finally {
    if (server.exitCode == null && !server.killed) {
      await killProcessTree(server.pid);
      await sleep(250);
    }
    if (server.exitCode == null && server.pid) {
      await killProcessTree(server.pid);
      await sleep(250);
    }
    if (!completedSuccessfully && server.exitCode != null && server.exitCode !== 0) {
      process.stderr.write(serverStdout);
      process.stderr.write(serverStderr);
    }
  }
};

main().catch((error) => {
  console.error(
    "[managed-ark-key-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
