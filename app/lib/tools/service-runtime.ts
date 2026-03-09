// @input: local service names, script paths, and host settings
// @output: shared workspace/service root resolution and detached Python service spawning
// @position: internal helper for local AI sidecar services

import { existsSync, mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const resolveWorkspaceRoot = (): string => {
  const candidates = [
    process.env.OMNIAGENT_WORKSPACE_ROOT?.trim(),
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "../.."),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (
      existsSync(join(root, ".vendor", "iopaint")) ||
      existsSync(join(root, "desktop", "island")) ||
      existsSync(join(root, "app", "lib", "tools"))
    ) {
      return root;
    }
  }

  return resolve(process.cwd());
};

export const workspaceRoot = resolveWorkspaceRoot();

export const serviceRoot = resolve(
  process.env.OMNIAGENT_SERVICE_ROOT?.trim() || join(workspaceRoot, ".omni-services"),
);

export const logRoot = resolve(
  process.env.OMNIAGENT_SERVICE_LOG_DIR?.trim() || join(workspaceRoot, "service-logs"),
);

export const pickPythonExecutable = (
  candidates: string[],
  fallback = "python",
): string => {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return fallback;
};

export const buildNoProxy = (hosts: string[]): string => {
  const current = [
    process.env.NO_PROXY,
    process.env.no_proxy,
    "127.0.0.1",
    "localhost",
    ...hosts,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(current)).join(",");
};

type SpawnDetachedPythonServiceArgs = {
  pythonBin: string;
  scriptPath: string;
  cwd?: string;
  stdoutName: string;
  stderrName: string;
  args?: string[];
  extraEnv?: Record<string, string>;
  noProxyHosts?: string[];
};

export const spawnDetachedPythonService = ({
  pythonBin,
  scriptPath,
  cwd,
  stdoutName,
  stderrName,
  args = [],
  extraEnv = {},
  noProxyHosts = [],
}: SpawnDetachedPythonServiceArgs): void => {
  mkdirSync(logRoot, { recursive: true });
  const stdoutFd = openSync(join(logRoot, stdoutName), "a");
  const stderrFd = openSync(join(logRoot, stderrName), "a");
  const noProxy = buildNoProxy(noProxyHosts);
  const env = {
    ...process.env,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    ...extraEnv,
  };

  const child = spawn(pythonBin, [scriptPath, ...args], {
    cwd: cwd ? resolve(cwd) : workspaceRoot,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
    env,
  });
  child.unref();
};
