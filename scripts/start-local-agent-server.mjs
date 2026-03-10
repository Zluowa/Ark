import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

const getArg = (flag, fallback) => {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  return fallback;
};

const hasFlag = (flag) => args.includes(flag);

const port = Number(getArg("--port", "3211"));
const envFile = resolve(process.cwd(), getArg("--env-file", ".moss/local-agent-server.env"));
const shouldIssueKey = hasFlag("--issue-key");
const host = getArg("--host", "127.0.0.1");

const parseEnvFile = (filePath) => {
  if (!existsSync(filePath)) {
    return {};
  }
  const source = readFileSync(filePath, "utf8");
  const entries = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1);
    entries[key] = value;
  }
  return entries;
};

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
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5000,
    },
  );
  if (result.status !== 0) {
    return "";
  }
  return normalizeProxyUrl(result.stdout);
};

if (shouldIssueKey) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "scripts/issue-local-api-key.mjs"),
      "--write",
      "--file",
      envFile,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "Failed to issue local API key.\n");
    process.exit(result.status ?? 1);
  }
  process.stdout.write(result.stdout);
}

const envFromFile = parseEnvFile(envFile);
const resolvedProxy =
  normalizeProxyUrl(envFromFile.MEDIA_PROXY) ||
  normalizeProxyUrl(envFromFile.HTTPS_PROXY) ||
  normalizeProxyUrl(envFromFile.HTTP_PROXY) ||
  normalizeProxyUrl(process.env.MEDIA_PROXY) ||
  normalizeProxyUrl(process.env.HTTPS_PROXY) ||
  normalizeProxyUrl(process.env.HTTP_PROXY) ||
  detectWindowsProxy();
const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
const commandArgs =
  process.platform === "win32"
    ? ["/c", "pnpm", "--dir", "app", "exec", "next", "start", "-H", host, "-p", String(port)]
    : ["--dir", "app", "exec", "next", "start", "-H", host, "-p", String(port)];
const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...envFromFile,
    ...(resolvedProxy
      ? {
          MEDIA_PROXY: resolvedProxy,
          HTTPS_PROXY: resolvedProxy,
          HTTP_PROXY: resolvedProxy,
        }
      : {}),
  },
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
