import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const argSet = new Set(process.argv.slice(2));

const readValue = (flag, fallback) => {
  const entry = process.argv.slice(2).find((item) => item.startsWith(`${flag}=`));
  if (!entry) return fallback;
  return entry.slice(flag.length + 1).trim() || fallback;
};

const dryRun = argSet.has("--dry-run");
const autoYes = argSet.has("--yes");
const profile = readValue("--profile", "full");

const envExample = path.join(repoRoot, "app", ".env.example");
const envLocal = path.join(repoRoot, "app", ".env.local");

const profileMap = {
  web: {
    title: "Web only",
    commands: ["pnpm --dir app install", "pnpm --dir app dev"],
  },
  full: {
    title: "Full local stack",
    commands: [
      "pnpm --dir app install",
      "docker compose -f infra/docker-compose.yml up -d",
      "pnpm --dir app dev",
      "cargo run --manifest-path desktop/Cargo.toml -p omniagent-island",
    ],
  },
  native: {
    title: "Web plus native island",
    commands: [
      "pnpm --dir app install",
      "pnpm --dir app dev",
      "cargo run --manifest-path desktop/Cargo.toml -p omniagent-island",
    ],
  },
};

if (!Object.hasOwn(profileMap, profile)) {
  console.error(
    `[ark:onboard] unsupported profile "${profile}". Use one of: ${Object.keys(profileMap).join(", ")}`,
  );
  process.exit(1);
}

const runCommand = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const printBlock = (title, lines) => {
  console.log(`\n${title}`);
  for (const line of lines) {
    console.log(`- ${line}`);
  }
};

const setupEnv = () => {
  if (existsSync(envLocal)) {
    console.log(`[ark:onboard] env already exists: ${path.relative(repoRoot, envLocal)}`);
    return;
  }
  copyFileSync(envExample, envLocal);
  console.log(`[ark:onboard] created ${path.relative(repoRoot, envLocal)} from .env.example`);
};

console.log(`[ark:onboard] profile: ${profileMap[profile].title}`);
console.log(`[ark:onboard] repo: ${repoRoot}`);

printBlock("Recommended commands", profileMap[profile].commands);
printBlock("Provider checklist", [
  "OPENAI_API_KEY or your compatible gateway values",
  "GEMINI_API_KEY or GOOGLE_API_KEY for screen analysis",
  "VOLCENGINE_APPID and VOLCENGINE_ACCESS_TOKEN for audio transcription",
  "TAVILY_API_KEY if you want web search",
]);
printBlock("Verification", [
  "Website: http://127.0.0.1:3010",
  "Dashboard: http://127.0.0.1:3010/dashboard",
  "Docs: docs/SELF_HOSTING.md",
  "Agent guide: docs/AGENT_DEPLOYMENT.md",
]);

if (dryRun) {
  console.log("\n[ark:onboard] dry run only, no files or services changed.");
  process.exit(0);
}

setupEnv();

if (!autoYes) {
  console.log("\n[ark:onboard] onboarding prepared. Re-run with --yes to install dependencies and start optional infra.");
  process.exit(0);
}

console.log("\n[ark:onboard] running install steps...");
runCommand("pnpm", ["--dir", "app", "install"]);

if (profile === "full") {
  console.log("\n[ark:onboard] starting docker compose infra...");
  runCommand("docker", ["compose", "-f", "infra/docker-compose.yml", "up", "-d"]);
}

console.log("\n[ark:onboard] next commands:");
if (profile === "web") {
  console.log("- pnpm --dir app dev");
} else if (profile === "native") {
  console.log("- pnpm --dir app dev");
  console.log("- cargo run --manifest-path desktop/Cargo.toml -p omniagent-island");
} else {
  console.log("- pnpm --dir app dev");
  console.log("- cargo run --manifest-path desktop/Cargo.toml -p omniagent-island");
}

console.log("\n[ark:onboard] done.");
