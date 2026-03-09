// @input: file URLs and shell commands from tool handlers
// @output: downloadFile, tempFile, runCommand, proxyFetch utilities
// @position: shared helpers for all tool implementations

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import http from "node:http";
import https from "node:https";

const execFileAsync = promisify(execFile);

export const downloadFile = async (url: string): Promise<Buffer> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

export const tempFile = (ext: string): string =>
  join(tmpdir(), `omni-${randomUUID()}.${ext}`);

export type CommandResult = { stdout: string; stderr: string; exitCode: number };

export const runCommand = async (
  cmd: string, args: string[], timeout?: number,
): Promise<CommandResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 100 * 1024 * 1024, ...(timeout !== undefined && { timeout }),
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? e.message, exitCode: typeof e.code === "number" ? e.code : 1 };
  }
};

/* ── Proxy HTTPS tunnel (for GFW-blocked sites like YouTube) ── */

const PROXY_URL = process.env.MEDIA_PROXY || process.env.HTTPS_PROXY || "";

type ProxyResponse = { status: number; headers: Record<string, string>; body: string };

function createTunnel(hostname: string): Promise<import("node:net").Socket> {
  if (!PROXY_URL) return Promise.reject(new Error("MEDIA_PROXY not configured"));
  const proxy = new URL(PROXY_URL);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxy.hostname, port: Number(proxy.port), method: "CONNECT", path: `${hostname}:443`,
    });
    req.on("connect", (res, socket) => res.statusCode === 200 ? resolve(socket) : reject(new Error(`CONNECT ${res.statusCode}`)));
    req.on("error", reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error("proxy tunnel timeout")); });
    req.end();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket option works at runtime but missing from TS types
type TunnelOpts = import("node:https").RequestOptions & { socket: import("node:net").Socket };

export async function proxyFetch(
  targetUrl: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<ProxyResponse> {
  const target = new URL(targetUrl);
  const socket = await createTunnel(target.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: target.hostname, path: target.pathname + target.search,
      method: opts.method || "GET", headers: opts.headers || {}, socket, agent: false,
    } as TunnelOpts, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => data += c.toString());
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v ?? ""])),
        body: data,
      }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* ── Security helpers ── */

const PATH_PATTERNS = [
  /\/(?:home|tmp|var|usr|opt|root|proc|sys|etc)\/\S*/g,
  /[A-Za-z]:\\[^\s,;]*/g,
  /\/tmp\/[^\s,;]*/g,
];

export const sanitizeStderr = (raw: string): string => {
  let s = raw;
  for (const pattern of PATH_PATTERNS) s = s.replace(pattern, "[path]");
  return s.slice(0, 200);
};

export async function proxyStreamToFile(
  targetUrl: string, dest: string, headers: Record<string, string> = {},
): Promise<void> {
  const target = new URL(targetUrl);
  const socket = await createTunnel(target.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: target.hostname, path: target.pathname + target.search,
      method: "GET", headers, socket, agent: false,
    } as TunnelOpts, (res) => {
      if (res.statusCode && res.statusCode >= 400) { reject(new Error(`proxy download ${res.statusCode}`)); return; }
      const ws = createWriteStream(dest);
      res.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}
