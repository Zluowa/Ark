import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const envFile = resolve(root, ".moss/web-account-smoke.env");
const host = "127.0.0.1";
const stateDir = resolve(root, ".moss/tmp/web-account-smoke-state");
const reportDir = resolve(
  root,
  "app",
  "test-screenshots",
  "2026-03-10-web-account-system-proof",
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
  const raw = preferred.includes("=")
    ? preferred.split("=").slice(1).join("=")
    : preferred;
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
  if (
    process.platform === "win32" &&
    (command === "pnpm" || command === "pnpm.cmd")
  ) {
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

const sleep = async (ms) => {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
};

const killProcessTree = async (pid) => {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "pipe",
    }).catch(() => {});
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

const reservePort = async (preferredPort = 3217) =>
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
      const port =
        typeof address === "object" && address ? address.port : preferredPort;
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
  return { response, body, text };
};

const extractCookie = (response, cookieName) => {
  const raw = response.headers.get("set-cookie") || "";
  const match = raw.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match) {
    return "";
  }
  return `${cookieName}=${match[1]}`;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(reportDir, { recursive: true, force: true });
  mkdirSync(reportDir, { recursive: true });

  await run("pnpm", ["--dir", "app", "build"]);

  const port = await reservePort();
  const baseUrl = `http://${host}:${port}`;

  const issueResult = await run(process.execPath, [
    resolve(root, "scripts/issue-local-api-key.mjs"),
    "--write",
    "--file",
    envFile,
    "--tenant",
    "web-account-smoke-operator",
    "--id",
    "web-account-smoke-operator-key",
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
  const server = spawn(serverCommand.command, serverCommand.commandArgs, {
    cwd: root,
    env: {
      ...baseEnv,
      ...envFromFile,
      OMNIAGENT_LOCAL_STATE_DIR: stateDir,
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

    const noAuthExecute = await requestJson(baseUrl, "/api/v1/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: '{"strict":true}',
          mode: "pretty",
        },
      }),
    });
    assert(
      noAuthExecute.response.status === 401,
      "strict api_key mode should reject execute without browser session or key",
    );

    const email = `web-account-${Date.now()}@example.com`;
    const password = "ArkPass1234!";
    const firstWorkspaceName = "Personal";

    const register = await requestJson(baseUrl, "/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Web Account Smoke",
        email,
        password,
        workspaceName: firstWorkspaceName,
      }),
    });
    assert(register.response.status === 201, "register should succeed");
    assert(register.body?.authenticated === true, "register should return authenticated session");
    const registerCookie = extractCookie(register.response, "ark_session");
    assert(registerCookie, "register should set ark_session cookie");

    const firstWorkspace = register.body?.session?.workspace;
    assert(firstWorkspace?.tenantId, "register should create first workspace tenant");

    const logout = await requestJson(baseUrl, "/api/account/logout", {
      method: "POST",
      headers: {
        Cookie: registerCookie,
      },
    });
    assert(logout.response.ok, "logout should succeed");

    const sessionAfterLogout = await requestJson(baseUrl, "/api/account/session", {
      headers: {
        Cookie: registerCookie,
      },
    });
    assert(
      sessionAfterLogout.body?.authenticated === false,
      "logged-out cookie should no longer resolve a session",
    );

    const login = await requestJson(baseUrl, "/api/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    assert(login.response.ok, "login should succeed");
    assert(login.body?.authenticated === true, "login should return authenticated session");
    const sessionCookie = extractCookie(login.response, "ark_session");
    assert(sessionCookie, "login should set ark_session cookie");

    const sessionPayload = await requestJson(baseUrl, "/api/account/session", {
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert(
      sessionPayload.body?.authenticated === true,
      "session endpoint should resolve browser session",
    );

    const sessionAdminKeys = await requestJson(baseUrl, "/api/v1/admin/api-keys", {
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert(
      sessionAdminKeys.response.status === 403,
      "browser session should not gain admin key-management scopes",
    );

    const firstExecute = await requestJson(baseUrl, "/api/v1/execute", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: '{"workspace":"first"}',
          mode: "pretty",
        },
      }),
    });
    assert(firstExecute.response.ok, "browser session execute should succeed");
    assert(firstExecute.body?.status === "success", "first browser session run should succeed");

    const firstSummary = await requestJson(baseUrl, "/api/v1/billing/summary", {
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert(firstSummary.response.ok, "first workspace billing summary should succeed");
    assert(
      firstSummary.body?.summary?.tenantId === firstWorkspace.tenantId,
      "billing summary should use first workspace tenant",
    );
    assert(
      Number(firstSummary.body?.summary?.month?.totalRuns) >= 1,
      "first workspace should record at least one run",
    );

    const createdWorkspace = await requestJson(baseUrl, "/api/account/workspaces", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Client Alpha",
      }),
    });
    assert(createdWorkspace.response.ok, "workspace creation should succeed");
    const secondWorkspace = createdWorkspace.body?.workspace;
    assert(secondWorkspace?.id, "workspace creation should return second workspace");
    assert(secondWorkspace?.tenantId, "second workspace should have tenant id");

    const switched = await requestJson(
      baseUrl,
      `/api/account/workspaces/${encodeURIComponent(secondWorkspace.id)}/switch`,
      {
        method: "POST",
        headers: {
          Cookie: sessionCookie,
        },
      },
    );
    assert(switched.response.ok, "workspace switch should succeed");
    assert(
      switched.body?.session?.workspace?.id === secondWorkspace.id,
      "workspace switch should activate second workspace",
    );

    const secondExecute = await requestJson(baseUrl, "/api/v1/execute", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: '{"workspace":"second"}',
          mode: "pretty",
        },
      }),
    });
    assert(secondExecute.response.ok, "second workspace execute should succeed");

    const secondSummary = await requestJson(baseUrl, "/api/v1/billing/summary", {
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert(secondSummary.response.ok, "second workspace billing summary should succeed");
    assert(
      secondSummary.body?.summary?.tenantId === secondWorkspace.tenantId,
      "billing summary should switch to second workspace tenant",
    );
    assert(
      Number(secondSummary.body?.summary?.month?.totalRuns) >= 1,
      "second workspace should record at least one run",
    );

    const forbiddenCrossTenantSummary = await requestJson(
      baseUrl,
      `/api/v1/billing/summary?tenant_id=${encodeURIComponent(firstWorkspace.tenantId)}`,
      {
        headers: {
          Cookie: sessionCookie,
        },
      },
    );
    assert(
      forbiddenCrossTenantSummary.response.status === 403,
      "browser session should not read billing summary for another tenant",
    );

    const deleted = await requestJson(baseUrl, "/api/account", {
      method: "DELETE",
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert(deleted.response.ok, "delete account should succeed");
    assert(
      Array.isArray(deleted.body?.deleted?.suspendedTenantIds) &&
        deleted.body.deleted.suspendedTenantIds.includes(firstWorkspace.tenantId) &&
        deleted.body.deleted.suspendedTenantIds.includes(secondWorkspace.tenantId),
      "delete account should suspend both workspace tenants",
    );

    const sessionAfterDelete = await requestJson(baseUrl, "/api/account/session", {
      headers: {
        Cookie: sessionCookie,
      },
    });
    assert(
      sessionAfterDelete.body?.authenticated === false,
      "deleted account session should no longer authenticate",
    );

    const executeAfterDelete = await requestJson(baseUrl, "/api/v1/execute", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "convert.json_format",
        params: {
          input: '{"deleted":true}',
          mode: "pretty",
        },
      }),
    });
    assert(
      executeAfterDelete.response.status === 401,
      "deleted account session should no longer authorize execution",
    );

    const loginAfterDelete = await requestJson(baseUrl, "/api/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    assert(
      loginAfterDelete.response.status === 401,
      "deleted account should no longer be able to log in",
    );

    const operatorHeaders = {
      "X-API-Key": issued.api_key,
    };
    const firstTenant = await requestJson(
      baseUrl,
      `/api/v1/admin/tenants/${encodeURIComponent(firstWorkspace.tenantId)}`,
      {
        headers: operatorHeaders,
      },
    );
    const secondTenant = await requestJson(
      baseUrl,
      `/api/v1/admin/tenants/${encodeURIComponent(secondWorkspace.tenantId)}`,
      {
        headers: operatorHeaders,
      },
    );
    assert(firstTenant.response.ok, "operator should read first tenant after delete");
    assert(secondTenant.response.ok, "operator should read second tenant after delete");
    assert(
      firstTenant.body?.tenant?.status === "suspended" &&
        secondTenant.body?.tenant?.status === "suspended",
      "deleted account tenants should be suspended",
    );

    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      baseUrl,
      email,
      operatorApiKeyId: issued.api_key_id,
      firstWorkspace: {
        id: firstWorkspace.id,
        tenantId: firstWorkspace.tenantId,
      },
      secondWorkspace: {
        id: secondWorkspace.id,
        tenantId: secondWorkspace.tenantId,
      },
      firstRunId: firstExecute.body?.run_id ?? null,
      secondRunId: secondExecute.body?.run_id ?? null,
      firstTenantMonthRuns: firstSummary.body?.summary?.month?.totalRuns ?? null,
      secondTenantMonthRuns:
        secondSummary.body?.summary?.month?.totalRuns ?? null,
      deletedTenantStatuses: {
        [firstWorkspace.tenantId]: firstTenant.body?.tenant?.status ?? null,
        [secondWorkspace.tenantId]: secondTenant.body?.tenant?.status ?? null,
      },
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
    "[web-account-smoke] FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
