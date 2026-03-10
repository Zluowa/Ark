import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const root = process.cwd();

const readArg = (flag, fallback = "") => {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  const inline = args.find((value) => value.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1);
  }
  return fallback;
};

const hasFlag = (flag) => args.includes(flag);

const host = readArg("--host", "");
const user = readArg("--user", "root");
const password =
  readArg("--password", "") ||
  (readArg("--password-env", "") ? process.env[readArg("--password-env", "")] ?? "" : "");
const remoteRoot = readArg("--remote-root", "/srv/ark");
const envSource = resolve(root, readArg("--env-source", "app/.env.local"));
const wipe = hasFlag("--wipe");

const localDeployEnvDir = resolve(root, "deploy");
mkdirSync(localDeployEnvDir, { recursive: true });
const remoteEnvPath = resolve(localDeployEnvDir, "server.env");

if (!host) {
  throw new Error("Missing --host");
}
if (!password) {
  throw new Error("Missing server password. Use --password or --password-env.");
}

const parseEnvFile = (filePath) => {
  try {
    const source = readFileSync(filePath, "utf8");
    const entries = {};
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
  } catch {
    return {};
  }
};

const sourceEnv = parseEnvFile(envSource);
const existingDeployEnv = !wipe ? parseEnvFile(remoteEnvPath) : {};
const remoteProxyEnv = {
  MEDIA_PROXY: process.env.ARK_REMOTE_MEDIA_PROXY?.trim() || "",
  HTTPS_PROXY: process.env.ARK_REMOTE_HTTPS_PROXY?.trim() || "",
  HTTP_PROXY: process.env.ARK_REMOTE_HTTP_PROXY?.trim() || "",
  NO_PROXY: process.env.ARK_REMOTE_NO_PROXY?.trim() || "",
};
const fromSource = (key, fallback = "") => {
  const runtime = process.env[key]?.trim();
  if (runtime) {
    return runtime;
  }
  const fileValue = sourceEnv[key]?.trim();
  if (fileValue) {
    return fileValue;
  }
  return fallback;
};

const fromExistingDeploy = (key, fallback = "") => {
  const value = existingDeployEnv[key]?.trim();
  if (value) {
    return value;
  }
  return fallback;
};

const randomToken = (prefix, bytes = 24) =>
  `${prefix}${randomBytes(bytes).toString("hex")}`;

const operatorKey =
  fromExistingDeploy("OMNIAGENT_API_KEY") || randomToken("ark_live_managed_", 24);
const postgresPassword =
  fromExistingDeploy("POSTGRES_PASSWORD") || randomToken("pg_", 18);
const minioAccessKey =
  fromExistingDeploy("MINIO_ROOT_USER") ||
  fromExistingDeploy("S3_ACCESS_KEY") ||
  `ark${randomBytes(8).toString("hex")}`;
const minioSecretKey =
  fromExistingDeploy("MINIO_ROOT_PASSWORD") ||
  fromExistingDeploy("S3_SECRET_KEY") ||
  randomToken("minio_", 24);
const credentialKey =
  fromExistingDeploy("OMNIAGENT_CREDENTIAL_KEY") ||
  randomBytes(32).toString("hex");
const publicUrl = `http://${host}`;

const envValues = {
  NEXT_PUBLIC_OMNIAGENT_GITHUB_URL: fromSource(
    "NEXT_PUBLIC_OMNIAGENT_GITHUB_URL",
    "https://github.com/Zluowa/Ark",
  ),
  OPENAI_API_KEY: fromSource("OPENAI_API_KEY"),
  OPENAI_BASE_URL: fromSource("OPENAI_BASE_URL"),
  OPENAI_MODEL: fromSource("OPENAI_MODEL", "gpt-4.1-mini"),
  OMNIAGENT_RELAY_BASE_URL: fromSource("OMNIAGENT_RELAY_BASE_URL"),
  OMNIAGENT_RELAY_API_KEY: fromSource("OMNIAGENT_RELAY_API_KEY"),
  OMNIAGENT_RELAY_MODEL: fromSource("OMNIAGENT_RELAY_MODEL"),
  OMNIAGENT_RELAY_PROTOCOL: fromSource("OMNIAGENT_RELAY_PROTOCOL", "chat"),
  OMNIAGENT_CHAT_MODEL: fromSource("OMNIAGENT_CHAT_MODEL"),
  GEMINI_API_KEY: fromSource("GEMINI_API_KEY"),
  GOOGLE_API_KEY: fromSource("GOOGLE_API_KEY"),
  GEMINI_BASE_URL: fromSource("GEMINI_BASE_URL"),
  GEMINI_VIDEO_MODEL: fromSource("GEMINI_VIDEO_MODEL", "gemini-2.5-flash"),
  VOLCENGINE_APPID: fromSource("VOLCENGINE_APPID"),
  VOLCENGINE_ACCESS_TOKEN: fromSource("VOLCENGINE_ACCESS_TOKEN"),
  VOLCENGINE_ASR_RESOURCE_ID: fromSource(
    "VOLCENGINE_ASR_RESOURCE_ID",
    "volc.seedasr.sauc.duration",
  ),
  TAVILY_API_KEY: fromSource("TAVILY_API_KEY"),
  MEDIA_PROXY: remoteProxyEnv.MEDIA_PROXY,
  HTTPS_PROXY: remoteProxyEnv.HTTPS_PROXY,
  HTTP_PROXY: remoteProxyEnv.HTTP_PROXY,
  NO_PROXY: remoteProxyEnv.NO_PROXY,
  OMNIAGENT_DISABLE_PROXY: fromSource("OMNIAGENT_DISABLE_PROXY"),
  OMNIAGENT_XHS_BRIDGE_URL: fromSource(
    "OMNIAGENT_XHS_BRIDGE_URL",
    "http://127.0.0.1:5556",
  ),
  OMNIAGENT_XHS_COOKIE: fromSource("OMNIAGENT_XHS_COOKIE") || fromSource("XHS_COOKIE"),
  OMNIAGENT_AUTH_MODE: "api_key",
  OMNIAGENT_SERVICE_MODE: "managed_ark_key",
  OMNIAGENT_API_KEY_ID: "managed-ark-operator",
  OMNIAGENT_API_KEY: operatorKey,
  OMNIAGENT_TENANT_ID: "platform",
  OMNIAGENT_API_KEY_SCOPES: "admin:*,execute:read,execute:write,runs:read",
  OMNIAGENT_CREDENTIAL_KEY: credentialKey,
  OMNIAGENT_OAUTH_BASE_URL: publicUrl,
  POSTGRES_USER: "omniagent",
  POSTGRES_PASSWORD: postgresPassword,
  POSTGRES_DB: "omniagent",
  MINIO_ROOT_USER: minioAccessKey,
  MINIO_ROOT_PASSWORD: minioSecretKey,
  MINIO_API_PORT: "39000",
  S3_ENDPOINT: `http://${host}:39000`,
  S3_INTERNAL_ENDPOINT: "http://minio:9000",
  S3_BUCKET: "ark-prod",
  S3_ACCESS_KEY: minioAccessKey,
  S3_SECRET_KEY: minioSecretKey,
  S3_REGION: "us-east-1",
  S3_SIGNED_URL_TTL_SEC: "3600",
  ARK_HTTP_PORT: "80",
};

const deploymentDir = resolve(root, ".moss", "deployment");
mkdirSync(deploymentDir, { recursive: true });
const localSecretPath = resolve(deploymentDir, "server-deploy.local.json");
const reportPath = resolve(deploymentDir, "server-deploy-report.md");

const envContent = Object.entries(envValues)
  .map(([key, value]) => `${key}=${String(value ?? "")}`)
  .join("\n")
  .trimEnd() + "\n";
writeFileSync(remoteEnvPath, envContent, "utf8");

writeFileSync(
  localSecretPath,
  JSON.stringify(
    {
      host,
      user,
      remoteRoot,
      publicUrl,
      operatorKey,
      envFile: remoteEnvPath,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
  "utf8",
);

const helper = resolve(root, "scripts", "_remote_server_ops.py");
const result = spawnSync(
  "python",
  [
    helper,
    "--host",
    host,
    "--user",
    user,
    "--password",
    password,
    "--repo-root",
    root,
    "--remote-root",
    remoteRoot,
    "--env-file",
    remoteEnvPath,
    ...(wipe ? ["--wipe"] : []),
  ],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  },
);

if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || "Remote deployment failed.");
}

const deployReport = JSON.parse(result.stdout);
const maskedKey =
  operatorKey.length > 12 ? `${operatorKey.slice(0, 8)}...${operatorKey.slice(-4)}` : "***";

const markdown = [
  "# Ark Remote Deployment Report",
  "",
  `- Host: \`${host}\``,
  `- Public URL: \`${publicUrl}\``,
  `- Remote root: \`${remoteRoot}\``,
  `- Wipe requested: \`${wipe}\``,
  `- Generated at: \`${new Date().toISOString()}\``,
  `- Operator key: \`${maskedKey}\``,
  `- Local secret file: \`${localSecretPath}\``,
  "",
  "## Cleanup",
  "",
  "```json",
  JSON.stringify(deployReport.cleanup ?? [], null, 2),
  "```",
  "",
  "## Deploy",
  "",
  "```json",
  JSON.stringify(deployReport.deploy ?? [], null, 2),
  "```",
  "",
  "## Inventory Before",
  "",
  "```json",
  JSON.stringify(deployReport.inventory_before ?? [], null, 2),
  "```",
  "",
  "## Inventory After",
  "",
  "```json",
  JSON.stringify(deployReport.inventory_after ?? [], null, 2),
  "```",
  "",
].join("\n");

writeFileSync(reportPath, markdown, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      host,
      public_url: publicUrl,
      remote_root: remoteRoot,
      report_path: reportPath,
      local_secret_path: localSecretPath,
      operator_key: operatorKey,
    },
    null,
    2,
  ),
);
