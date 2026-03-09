import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const envLocalPath = path.resolve(appRoot, ".env.local");

const parseEnvFile = (raw) => {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
};

const envFileVars = existsSync(envLocalPath)
  ? parseEnvFile(readFileSync(envLocalPath, "utf8"))
  : {};
const getVar = (name) => process.env[name] ?? envFileVars[name];

const appPort = process.env.OMNIAGENT_APP_PORT ?? "3010";
const relayBaseUrl = getVar("OMNIAGENT_RELAY_BASE_URL") ?? "";
const relayApiKey =
  getVar("OMNIAGENT_RELAY_API_KEY") ?? getVar("OPENAI_API_KEY") ?? "";

if (!relayBaseUrl && !process.env.OPENAI_API_KEY) {
  console.warn(
    "[omniagent] Missing relay/OpenAI config. Set OMNIAGENT_RELAY_BASE_URL + OMNIAGENT_RELAY_API_KEY (recommended).",
  );
}

if (relayBaseUrl && !relayApiKey) {
  console.warn(
    "[omniagent] Relay base URL is set but key is missing. Set OMNIAGENT_RELAY_API_KEY.",
  );
}

const child = spawn("pnpm", ["dev:app"], {
  cwd: appRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    PORT: appPort,
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
