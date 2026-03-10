import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

const root = process.cwd();
const envFile = resolve(root, ".moss/local-agent-server-smoke.env");
const host = "127.0.0.1";

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
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

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

const reservePort = async (preferredPort = 3211) =>
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

const requestJson = async (path, options = {}) => {
  const { baseUrl, ...fetchOptions } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: {
      Accept: "application/json",
      ...(fetchOptions.headers ?? {}),
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
    "smoke-local-agent-server",
    "--id",
    "smoke-local-agent-key",
    "--scopes",
    "admin:*,execute:read,execute:write,runs:read",
  ]);
  const issued = JSON.parse(issueResult.stdout);
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
  const server = spawn(
    serverCommand.command,
    serverCommand.commandArgs,
    {
      cwd: root,
      env: {
        ...baseEnv,
        ...envFromFile,
      },
      stdio: "pipe",
    },
  );

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

    const publicPlatform = await requestJson("/api/v1/platform", { baseUrl });
    assert(publicPlatform.response.ok, "platform endpoint should be public");
    assert(publicPlatform.body?.brand?.name === "Ark", "platform brand should be Ark");

    const publicTools = await requestJson("/api/v1/tools/registry", { baseUrl });
    assert(publicTools.response.ok, "tool registry should be public");
    assert(Number(publicTools.body?.total) > 0, "tool registry total should be > 0");

    const noKeyExecute = await requestJson("/api/v1/execute", {
      baseUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"strict\":true}",
          mode: "pretty",
        },
      }),
    });
    assert(noKeyExecute.response.status === 401, "strict api_key mode should reject execute without key");

    const authHeaders = {
      "X-API-Key": issued.api_key,
      "Content-Type": "application/json",
    };
    const createdTenantId = `smoke-agent-tenant-${Date.now()}`;
    const createdApiKeyId = `smoke-agent-runner-${Date.now()}`;

    const bootstrapKeys = await requestJson("/api/v1/admin/api-keys", {
      baseUrl,
      headers: {
        "X-API-Key": issued.api_key,
      },
    });
    assert(bootstrapKeys.response.ok, "bootstrap key should list api keys");
    assert(
      Number(bootstrapKeys.body?.total) >= 1,
      "bootstrap key listing should include at least one key",
    );

    const createTenant = await requestJson("/api/v1/admin/tenants", {
      baseUrl,
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        id: createdTenantId,
        name: "Smoke Agent Tenant",
        quota: {
          burstPerMinute: 30,
          concurrencyLimit: 4,
          monthlyLimit: 240,
        },
      }),
    });
    assert(createTenant.response.ok, "admin create tenant should succeed");
    assert(
      typeof createTenant.body?.bootstrap_api_key === "string" &&
        createTenant.body.bootstrap_api_key,
      "create tenant should return bootstrap_api_key",
    );
    assert(
      createTenant.body?.tenant?.id === createdTenantId,
      "created tenant should be returned from tenant API",
    );

    const tenantList = await requestJson("/api/v1/admin/tenants", {
      baseUrl,
      headers: {
        "X-API-Key": issued.api_key,
      },
    });
    assert(tenantList.response.ok, "admin tenant listing should succeed");
    assert(
      Array.isArray(tenantList.body?.tenants) &&
        tenantList.body.tenants.some((tenant) => tenant?.id === createdTenantId),
      "created tenant should appear in tenant list",
    );

    const tenantDetails = await requestJson(
      `/api/v1/admin/tenants/${encodeURIComponent(createdTenantId)}`,
      {
        baseUrl,
        headers: {
          "X-API-Key": issued.api_key,
        },
      },
    );
    assert(tenantDetails.response.ok, "admin tenant details should succeed");
    assert(
      tenantDetails.body?.tenant?.quota?.monthlyLimit === 240,
      "tenant details should include initial quota",
    );

    const tenantUpdated = await requestJson(
      `/api/v1/admin/tenants/${encodeURIComponent(createdTenantId)}`,
      {
        baseUrl,
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          quota: {
            burstPerMinute: 20,
            concurrencyLimit: 3,
            monthlyLimit: 180,
          },
        }),
      },
    );
    assert(tenantUpdated.response.ok, "admin tenant update should succeed");
    assert(
      tenantUpdated.body?.tenant?.quota?.monthlyLimit === 180,
      "tenant quota update should persist",
    );

    const tenantBootstrapApiKey = String(createTenant.body.bootstrap_api_key);
    const tenantBootstrapHeaders = {
      "X-API-Key": tenantBootstrapApiKey,
      "Content-Type": "application/json",
    };

    const listedAfterCreate = await requestJson("/api/v1/admin/api-keys", {
      baseUrl,
      headers: {
        "X-API-Key": tenantBootstrapApiKey,
      },
    });
    assert(listedAfterCreate.response.ok, "tenant bootstrap key listing should succeed");
    assert(
      Array.isArray(listedAfterCreate.body?.keys) &&
        listedAfterCreate.body.keys.some((record) => record?.id === `${createdTenantId}-bootstrap`),
      "tenant bootstrap key should only see its tenant key set",
    );

    const tenantCantListAll = await requestJson("/api/v1/admin/tenants", {
      baseUrl,
      headers: {
        "X-API-Key": tenantBootstrapApiKey,
      },
    });
    assert(
      tenantCantListAll.response.status === 403,
      "tenant bootstrap key should not list platform tenants",
    );

    const tenantCantMintAdmin = await requestJson("/api/v1/admin/api-keys", {
      baseUrl,
      method: "POST",
      headers: tenantBootstrapHeaders,
      body: JSON.stringify({
        id: `${createdTenantId}-forbidden`,
        scopes: ["admin:*", "execute:write"],
      }),
    });
    assert(
      tenantCantMintAdmin.response.status === 403,
      "tenant bootstrap key should not escalate into admin scopes",
    );

    const createdKey = await requestJson("/api/v1/admin/api-keys", {
      baseUrl,
      method: "POST",
      headers: tenantBootstrapHeaders,
      body: JSON.stringify({
        id: createdApiKeyId,
        scopes: ["execute:read", "execute:write", "runs:read"],
      }),
    });
    assert(createdKey.response.ok, "tenant bootstrap key should create scoped api key");
    assert(
      typeof createdKey.body?.api_key === "string" && createdKey.body.api_key,
      "tenant bootstrap create key should return raw api_key",
    );

    const agentApiKey = String(createdKey.body.api_key);
    const agentHeaders = {
      "X-API-Key": agentApiKey,
      "Content-Type": "application/json",
    };

    const syncRun = await requestJson("/api/v1/execute", {
      baseUrl,
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"sync\":true}",
          mode: "pretty",
        },
      }),
    });
    assert(syncRun.response.ok, "sync execute should succeed with key");
    assert(syncRun.body?.status === "success", "sync execute should return success");

    const asyncRun = await requestJson("/api/v1/execute/async", {
      baseUrl,
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"async\":true}",
          mode: "minify",
        },
      }),
    });
    assert(asyncRun.response.ok, "async execute should succeed with key");
    const jobId = asyncRun.body?.job_id;
    assert(typeof jobId === "string" && jobId, "async execute should return job_id");

    let jobStatus = "queued";
    for (let index = 0; index < 40; index += 1) {
      const job = await requestJson(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        baseUrl,
        headers: {
          "X-API-Key": agentApiKey,
        },
      });
      assert(job.response.ok, "job polling should succeed");
      jobStatus = String(job.body?.status ?? "");
      if (jobStatus === "completed") {
        break;
      }
      await sleep(250);
    }
    assert(jobStatus === "completed", `job should complete, got ${jobStatus}`);

    const summary = await requestJson("/api/v1/billing/summary", {
      baseUrl,
      headers: {
        "X-API-Key": agentApiKey,
      },
    });
    assert(summary.response.ok, "billing summary should succeed");

    const usage = await requestJson("/api/v1/billing/usage?limit=10", {
      baseUrl,
      headers: {
        "X-API-Key": agentApiKey,
      },
    });
    assert(usage.response.ok, "billing usage should succeed");
    assert(Number(usage.body?.count) >= 2, "usage should record sync and async runs");

    const adminSdkEnv = {
      ...process.env,
      ARK_BASE_URL: baseUrl,
      ARK_API_KEY: issued.api_key,
      ARK_EXPECT_KEYS: "1",
      ARK_EXPECT_TENANTS: "1",
    };
    await run("node", ["scripts/smoke-ark-sdk-ts.mjs"], { env: adminSdkEnv });
    await run("python", ["scripts/smoke-ark-sdk-python.py"], { env: adminSdkEnv });

    const bootstrapSdkEnv = {
      ...process.env,
      ARK_BASE_URL: baseUrl,
      ARK_API_KEY: tenantBootstrapApiKey,
      ARK_EXPECT_KEYS: "1",
    };
    await run("node", ["scripts/smoke-ark-sdk-ts.mjs"], { env: bootstrapSdkEnv });
    await run("python", ["scripts/smoke-ark-sdk-python.py"], { env: bootstrapSdkEnv });

    const agentSdkEnv = {
      ...process.env,
      ARK_BASE_URL: baseUrl,
      ARK_API_KEY: agentApiKey,
    };
    await run("node", ["scripts/smoke-ark-sdk-ts.mjs"], { env: agentSdkEnv });
    await run("python", ["scripts/smoke-ark-sdk-python.py"], { env: agentSdkEnv });
    await run("node", ["scripts/smoke-mcp-server.mjs"], { env: agentSdkEnv });
    await run("node", ["app/scripts/smoke-video-subtitle-proof.mjs"], {
      env: {
        ...agentSdkEnv,
        OMNIAGENT_APP_BASE_URL: baseUrl,
        OMNIAGENT_API_KEY: agentApiKey,
      },
    });
    await run("node", ["app/scripts/smoke-remote-video-subtitle-proof.mjs"], {
      env: {
        ...agentSdkEnv,
        OMNIAGENT_APP_BASE_URL: baseUrl,
        OMNIAGENT_API_KEY: agentApiKey,
      },
    });

    const revokeKey = await requestJson(
      `/api/v1/admin/api-keys/${encodeURIComponent(createdApiKeyId)}`,
      {
        baseUrl,
        method: "DELETE",
        headers: {
          "X-API-Key": tenantBootstrapApiKey,
        },
      },
    );
    assert(revokeKey.response.ok, "tenant bootstrap key should revoke scoped api key");

    const revokedExecute = await requestJson("/api/v1/execute", {
      baseUrl,
      method: "POST",
      headers: agentHeaders,
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: "{\"revoked\":true}",
          mode: "pretty",
        },
      }),
    });
    assert(
      revokedExecute.response.status === 401,
      "revoked api key should no longer authorize execution",
    );

    const suspendTenant = await requestJson(
      `/api/v1/admin/tenants/${encodeURIComponent(createdTenantId)}`,
      {
        baseUrl,
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          status: "suspended",
        }),
      },
    );
    assert(suspendTenant.response.ok, "admin should suspend tenant");

    const suspendedBootstrapList = await requestJson("/api/v1/admin/api-keys", {
      baseUrl,
      headers: {
        "X-API-Key": tenantBootstrapApiKey,
      },
    });
    assert(
      suspendedBootstrapList.response.status === 403,
      "suspended tenant bootstrap key should be blocked",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          tenantId: issued.tenant_id,
          apiKeyId: issued.api_key_id,
          createdTenantId,
          createdApiKeyId,
          toolTotal: publicTools.body?.total,
          usageCount: usage.body?.count,
          jobStatus,
        },
        null,
        2,
      ),
    );
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
    if (server.exitCode == null) {
      server.unref();
      server.removeAllListeners();
      server.stdout?.destroy();
      server.stderr?.destroy();
      server.stdin?.destroy();
    }
    if (!completedSuccessfully && server.exitCode != null && server.exitCode !== 0) {
      process.stderr.write(serverStdout);
      process.stderr.write(serverStderr);
    }
  }
};

main().catch((error) => {
  console.error(
    "[local-agent-server-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
