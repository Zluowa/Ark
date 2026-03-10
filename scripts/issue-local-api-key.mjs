import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = new Set(process.argv.slice(2));

const resolveArgValue = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
};

const root = process.cwd();
const envFile = resolve(root, resolveArgValue("--file", "app/.env.local"));
const tenantId = resolveArgValue("--tenant", "local-agent-server");
const apiKeyId = resolveArgValue("--id", "local-agent-key");
const scopes =
  resolveArgValue(
    "--scopes",
    "admin:*,execute:read,execute:write,runs:read",
  ) || "admin:*,execute:read,execute:write,runs:read";
const apiKey =
  resolveArgValue("--key", "") ||
  `ark_live_local_${randomBytes(24).toString("hex")}`;
const writeMode = args.has("--write");

const upsertEnvValue = (source, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (pattern.test(source)) {
    return source.replace(pattern, line);
  }
  return source.trimEnd() + `\n${line}\n`;
};

const envSnippet = [
  "OMNIAGENT_AUTH_MODE=api_key",
  `OMNIAGENT_API_KEY=${apiKey}`,
  `OMNIAGENT_API_KEY_ID=${apiKeyId}`,
  `OMNIAGENT_TENANT_ID=${tenantId}`,
  `OMNIAGENT_API_KEY_SCOPES=${scopes}`,
].join("\n");

if (writeMode) {
  const existing = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  mkdirSync(dirname(envFile), { recursive: true });
  let next = existing;
  next = upsertEnvValue(next, "OMNIAGENT_AUTH_MODE", "api_key");
  next = upsertEnvValue(next, "OMNIAGENT_API_KEY", apiKey);
  next = upsertEnvValue(next, "OMNIAGENT_API_KEY_ID", apiKeyId);
  next = upsertEnvValue(next, "OMNIAGENT_TENANT_ID", tenantId);
  next = upsertEnvValue(next, "OMNIAGENT_API_KEY_SCOPES", scopes);
  writeFileSync(envFile, next, "utf8");
}

const output = {
  wrote_file: writeMode,
  env_file: envFile,
  auth_mode: "api_key",
  api_key_id: apiKeyId,
  tenant_id: tenantId,
  scopes: scopes.split(",").map((value) => value.trim()).filter(Boolean),
  api_key: apiKey,
  snippet: envSnippet,
  examples: {
    curl_registry: "curl -s http://127.0.0.1:3010/api/v1/tools/registry",
    curl_execute: `curl -X POST http://127.0.0.1:3010/api/v1/execute -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" -d "{\\"tool\\":\\"convert.json_format\\",\\"params\\":{\\"input\\":\\"{\\\\\\"ok\\\\\\":true}\\",\\"mode\\":\\"pretty\\"}}"`,
    curl_list_keys: `curl -s http://127.0.0.1:3010/api/v1/admin/api-keys -H "X-API-Key: ${apiKey}"`,
  },
};

console.log(JSON.stringify(output, null, 2));
