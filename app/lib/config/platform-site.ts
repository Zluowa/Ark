type PublicNavItem = {
  label: string;
  href: string;
};

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

type FooterColumn = {
  title: string;
  links: FooterLink[];
};

export const publicNav: PublicNavItem[] = [
  { label: "Product", href: "/" },
  { label: "Docs", href: "/docs" },
  { label: "Developers", href: "/developers" },
  { label: "Skills", href: "/skills" },
  { label: "Pricing", href: "/pricing" },
  { label: "Enterprise", href: "/enterprise" },
  { label: "Open source", href: "/open-source" },
] as const;

export const footerColumns: FooterColumn[] = [
  {
    title: "Platform",
    links: [
      { label: "Web workspace", href: "/" },
      { label: "Desktop island", href: "/" },
      { label: "Docs", href: "/docs" },
      { label: "Open source", href: "/open-source" },
    ],
  },
  {
    title: "Builders",
    links: [
      { label: "Developers", href: "/developers" },
      { label: "Skills", href: "/skills" },
      { label: "Enterprise", href: "/enterprise" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Runtime",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Auth", href: "/auth" },
      { label: "Platform contract", href: "/api/v1/platform" },
      { label: "Tool registry", href: "/api/v1/tools/registry" },
    ],
  },
  {
    title: "Source",
    links: [
      {
        label: "GitHub",
        href: "https://github.com/Zluowa/Ark",
        external: true,
      },
      {
        label: "Local agent server",
        href: "https://github.com/Zluowa/Ark/blob/main/docs/LOCAL_AGENT_SERVER.md",
        external: true,
      },
      {
        label: "MCP guide",
        href: "https://github.com/Zluowa/Ark/blob/main/docs/MCP_SERVER.md",
        external: true,
      },
      {
        label: "API platform",
        href: "https://github.com/Zluowa/Ark/blob/main/docs/API_PLATFORM.md",
        external: true,
      },
    ],
  },
] as const;

export const operatingModes = [
  {
    id: "managed",
    title: "Managed / lightweight Ark",
    summary:
      "User signs in once, gets a browser session, and uses Ark through the hosted backend. Web and lightweight desktop stay thin; execution remains server-side.",
    bullets: [
      "Best for end users who want Web or lightweight desktop without self-hosting",
      "One account powers browser sessions and workspace context",
      "Server-side execution keeps provider keys and artifacts off the client",
      "Overseas media support depends on the server's network and proxy posture",
    ],
  },
  {
    id: "self-hosted",
    title: "Self-hosted / full Ark",
    summary:
      "Operator deploys the complete stack, runs Island plus Web plus API, brings provider keys, and controls local storage, credentials, and network policy.",
    bullets: [
      "Best for teams that want BYOK, private data boundaries, or custom integrations",
      "Operator issues deployment keys or tenant bootstrap keys",
      "Local or server-side proxy config can be used for overseas platforms",
      "Web, desktop, API, SDK, and MCP all point at the same deployment",
    ],
  },
] as const;

export const platformPillars = [
  {
    title: "One account for people",
    detail:
      "Browser login, workspace switching, consumer settings, and usage live on the account surface instead of being scattered across special-case pages.",
  },
  {
    title: "One API key for execution",
    detail:
      "Agents, enterprise services, SDKs, and managed tenants all call the same execution backend with one runtime key model.",
  },
  {
    title: "One shared capability layer",
    detail:
      "Desktop island, Web workspace, REST, SDK, MCP, and future skill packs all sit on the same file, job, artifact, and provider boundary.",
  },
  {
    title: "One honest product story",
    detail:
      "Self-hosted, managed, open source, and enterprise lanes are explained as operating modes of the same platform instead of separate products.",
  },
] as const;

export const docsSections = [
  {
    id: "overview",
    title: "Overview",
    summary:
      "Ark is one execution platform with four surfaces: account, Web, desktop island, and API.",
  },
  {
    id: "modes",
    title: "Operating modes",
    summary:
      "Choose managed / lightweight Ark when you want hosted execution, or self-hosted / full Ark when you need BYOK and infrastructure control.",
  },
  {
    id: "identity",
    title: "Account and key model",
    summary:
      "One browser account for people, one runtime key model for agents, and tenant / managed key layers for operators.",
  },
  {
    id: "api",
    title: "API quickstart",
    summary:
      "Discover tools, upload files, run sync executions, then move long tasks to async jobs.",
  },
  {
    id: "sdk",
    title: "SDK and MCP",
    summary:
      "TypeScript, Python, and MCP are live adapters around the same backend contract.",
  },
  {
    id: "skills",
    title: "Skills",
    summary:
      "Ark skills are the workflow packaging layer above registry, files, execute, async jobs, and artifacts.",
  },
  {
    id: "deployment",
    title: "Deployment",
    summary:
      "Open source and self-hosting remain first-class. Managed mode is the hosted control path built on the same backend.",
  },
  {
    id: "truth",
    title: "Live now vs roadmap",
    summary:
      "The docs distinguish what the repo already ships from what is still being productized.",
  },
] as const;

export const docCards = [
  {
    title: "Docs hub",
    description:
      "Quickstart, modes, API, SDK, skills, deployment, and live boundaries.",
    href: "/docs",
  },
  {
    title: "Developers",
    description:
      "Execution contract, endpoint map, code samples, and operator paths.",
    href: "/developers",
  },
  {
    title: "Open source",
    description:
      "BYOK deployment, demo media, env groups, and public-safe setup notes.",
    href: "/open-source",
  },
  {
    title: "Enterprise",
    description:
      "SDK integration, managed tenant model, and platform rollout guidance.",
    href: "/enterprise",
  },
  {
    title: "Skills",
    description: "How skills sit on top of the shared execution layer.",
    href: "/skills",
  },
  {
    title: "Pricing",
    description:
      "Package the same platform for hobby, operator-managed, and enterprise lanes.",
    href: "/pricing",
  },
] as const;

export const pricingPlans = [
  {
    title: "Hobby / self-hosted",
    price: "BYOK",
    status: "Live now",
    summary:
      "Run the full stack yourself, bring your own provider keys, and issue deployment keys from your own environment.",
    bullets: [
      "Web, desktop island, REST, SDK, and MCP on one deployment",
      "Operator-controlled env, quota, artifacts, and credentials",
      "Best for personal setups and engineering teams that want full control",
    ],
  },
  {
    title: "Managed workspace",
    price: "Operator-managed",
    status: "Live in repo",
    summary:
      "Use Ark's managed key model so end users and internal teams do not need raw provider keys in each request.",
    bullets: [
      "One account for browser sessions",
      "Tenant-facing runtime keys for agents or lightweight clients",
      "Ideal when you want a hosted control plane on top of the same backend",
    ],
  },
  {
    title: "Enterprise",
    price: "Custom",
    status: "Sales-led",
    summary:
      "Add SDK integration, tenant controls, usage policy, and deployment routing on top of Ark's shared execution layer.",
    bullets: [
      "REST, TypeScript SDK, Python SDK, and MCP adapters",
      "Managed tenants, quotas, usage visibility, and operator controls",
      "Designed for agent products, internal AI platforms, and tool acceleration",
    ],
  },
] as const;

export const enterpriseTracks = [
  {
    title: "Embed the execution layer",
    detail:
      "Use Ark behind your own agent, app, or workflow service so deterministic tool work leaves the model path.",
  },
  {
    title: "Issue tenant-facing keys",
    detail:
      "Provision managed tenants or self-hosted tenants so one customer account can unlock the same backend safely.",
  },
  {
    title: "Ship faster with adapters",
    detail:
      "Start with REST. Move to TypeScript, Python, or MCP where the integration needs more velocity or better ergonomics.",
  },
  {
    title: "Keep artifacts server-side",
    detail:
      "Files, output bundles, downloads, transcripts, and generated results remain first-class platform objects.",
  },
] as const;

export const skillStories = [
  {
    title: "Skill packs are not a second backend",
    detail:
      "A skill sits above the same registry, files, execute, async jobs, and artifact endpoints. It packages intent and workflow, not a new runtime.",
  },
  {
    title: "Start from the live adapters",
    detail:
      "REST, TypeScript SDK, Python SDK, and MCP already expose the primitives a skill needs. Skills standardize how a product or agent consumes them.",
  },
  {
    title: "Use skills to compress tool-calling",
    detail:
      "For teams, the value is fewer repeated prompt patterns and faster reuse across internal agents, copilots, and operator workflows.",
  },
  {
    title: "Desktop, Web, and API can share the same capability graph",
    detail:
      "A skill should not care whether the initiating surface is the island, the Web workspace, or a backend agent. The execution layer is shared.",
  },
] as const;

export const skillQuickstarts = [
  {
    id: "local-server",
    title: "Start a local Ark runtime",
    summary:
      "Bring up a strict local Ark server, issue a runtime key, and let your agent call one backend for files, execute, async jobs, and artifacts.",
    command:
      "node scripts/start-local-agent-server.mjs --issue-key --port 3211",
    note: "Run this from the Ark repo root. Verified locally on 2026-03-13 with the full `pnpm local:server:smoke` contract.",
  },
  {
    id: "mcp",
    title: "Expose Ark over MCP",
    summary:
      "Use the stdio MCP adapter when the host agent already understands MCP and just needs the live Ark tool catalog.",
    command:
      '$env:ARK_BASE_URL="http://127.0.0.1:3211"; $env:ARK_API_KEY="your_runtime_key"; pnpm mcp:start',
    note: "Run from the Ark repo root after the local runtime is healthy. Verified locally on 2026-03-13 with `pnpm mcp:smoke` against port 3211.",
  },
  {
    id: "typescript-sdk",
    title: "Install the TypeScript SDK",
    summary:
      "Use the thin official client when your product, backend service, or agent runtime already lives in TypeScript.",
    command: "pnpm add file:../path-to-Ark/sdk/typescript",
    note: "The SDK is repo-local today and not yet published to npm. Verified locally on 2026-03-13 with `pnpm add file:../projects/omniagent-new/sdk/typescript`.",
  },
  {
    id: "python-sdk",
    title: "Install the Python SDK",
    summary:
      "Use the Python client for workers, notebooks, orchestration services, or backend agents that need direct Ark access.",
    command: "pip install -e sdk/python",
    note: "Run this from the Ark repo root. Verified locally on 2026-03-13 with `python -m pip install -e sdk/python`.",
  },
] as const;

export const skillInstallTracks = [
  {
    title: "MCP hosts",
    detail:
      "Choose MCP when the host already knows how to mount tools and you want Ark's live registry to appear without writing another adapter.",
  },
  {
    title: "Server agents",
    detail:
      "Choose the TypeScript or Python SDK when your agent already runs in a service and should call Ark programmatically.",
  },
  {
    title: "Self-hosted operator teams",
    detail:
      "Start a local Ark server when you want one shared execution endpoint that Web, island, and agents all point at inside your own environment.",
  },
  {
    title: "Skill-pack authors",
    detail:
      "Package workflow in `SKILL.md` folders above Ark's files, execute, async jobs, and artifact contract instead of inventing a second runtime.",
  },
] as const;

export const skillPackPrinciples = [
  "A skill should discover the live Ark catalog instead of hardcoding tool assumptions.",
  "A skill should move files and artifacts through Ark's file and artifact endpoints, not bespoke temporary storage.",
  "A skill should choose sync or async execution based on task length, while keeping the same runtime key model.",
  "A skill should stay portable across Web, desktop, MCP, SDK, and future packaged catalogs.",
] as const;

export const skillPackFilesystem = `ark-runtime-skill/
鈹溾攢 SKILL.md
鈹溾攢 agents/
鈹? 鈹斺攢 openai.yaml
鈹溾攢 scripts/
鈹斺攢 references/`;

export const apiExamples = {
  registry: `curl -s http://127.0.0.1:3010/api/v1/tools/registry`,
  sync: `curl -X POST http://127.0.0.1:3010/api/v1/execute \\
  -H "X-API-Key: $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"pdf.compress","params":{"file_url":"https://example.com/input.pdf"}}'`,
  async: `curl -X POST http://127.0.0.1:3010/api/v1/execute/async \\
  -H "X-API-Key: $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"media.download_video","params":{"url":"https://www.bilibili.com/video/BV..."}}'`,
  typescript: `import { ArkClient } from "@ark/client";

const client = new ArkClient({
  baseUrl: "http://127.0.0.1:3010",
  apiKey: process.env.ARK_API_KEY,
});

const platform = await client.getPlatform();
const tools = await client.listTools();
const execution = await client.execute("convert.json_format", {
  input: "{\\"ok\\":true}",
  mode: "pretty",
});`,
  python: `from ark_sdk import ArkClient

client = ArkClient(
    base_url="http://127.0.0.1:3010",
    api_key=None,
)

platform = client.get_platform()
tools = client.list_tools()
execution = client.execute(
    "convert.json_format",
    {"input": "{\\"ok\\": true}", "mode": "pretty"},
)`,
};
