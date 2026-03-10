import { getToolManifests, TOOL_COUNT } from "@/lib/tools/get-tools";

type IntegrationStatus = "available" | "planned";

type ProductSurfaceId = "island" | "web" | "api" | "backend";

type ProductSurface = {
  id: ProductSurfaceId;
  audience: "consumer" | "enterprise" | "agent" | "shared";
  title: string;
  summary: string;
};

type IntegrationSurface = {
  id: "rest" | "typescript_sdk" | "python_sdk" | "mcp" | "skill";
  name: string;
  status: IntegrationStatus;
  summary: string;
};

type ServiceMode = {
  id: "self_hosted_byok" | "managed_ark_key";
  status: IntegrationStatus;
  title: string;
  summary: string;
};

type EndpointContract = {
  path: string;
  auth: "public" | "api_key";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  summary: string;
};

const artifactTypes = [
  "txt",
  "md",
  "json",
  "pdf",
  "docx",
  "srt",
  "vtt",
  "mp3",
  "mp4",
  "gif",
  "png",
  "zip",
];

const surfaces: ProductSurface[] = [
  {
    id: "island",
    audience: "consumer",
    title: "Dynamic Island",
    summary:
      "The lightweight consumer surface. One sentence starts capture, editing, playback, or resume without opening a full workspace first.",
  },
  {
    id: "web",
    audience: "consumer",
    title: "Web workspace",
    summary:
      "The full consumer surface for files, history, configuration, connections, and deeper workflow control.",
  },
  {
    id: "api",
    audience: "enterprise",
    title: "API",
    summary:
      "The enterprise and agent surface. One deployment key unlocks the whole current Ark catalog without rebuilding the tool layer yourself.",
  },
  {
    id: "backend",
    audience: "shared",
    title: "Shared capability layer",
    summary:
      "The backend beneath Island, Web, and API. Deterministic execution, async jobs, files, artifacts, and provider-backed utilities live here.",
  },
];

const integrations: IntegrationSurface[] = [
  {
    id: "rest",
    name: "REST API",
    status: "available",
    summary:
      "Available now. API-key authenticated execution, async jobs, files, and tool discovery.",
  },
  {
    id: "typescript_sdk",
    name: "TypeScript SDK",
    status: "available",
    summary:
      "Available now. Thin official client around platform discovery, files, sync execution, async jobs, and polling.",
  },
  {
    id: "python_sdk",
    name: "Python SDK",
    status: "available",
    summary:
      "Available now. Thin official client for backend agents and enterprise integrations.",
  },
  {
    id: "mcp",
    name: "MCP server",
    status: "available",
    summary:
      "Available now. A stdio MCP adapter exposes the live Ark tool catalog and forwards tool calls to the same execution API.",
  },
  {
    id: "skill",
    name: "Skill packs",
    status: "planned",
    summary:
      "Planned platform-specific workflow packs built on top of the same execution API.",
  },
];

const serviceModes: ServiceMode[] = [
  {
    id: "self_hosted_byok",
    status: "available",
    title: "Self-hosted BYOK",
    summary:
      "Available now. Teams run Ark themselves, bring provider keys, and issue deployment API keys for their own environment.",
  },
  {
    id: "managed_ark_key",
    status: "available",
    title: "Managed Ark key",
    summary:
      "Available as a local operator-managed service mode in this repo. One Ark-issued tenant key unlocks the managed execution layer without the client wiring provider keys into each request.",
  },
];

const endpoints: EndpointContract[] = [
  {
    path: "/api/v1/tools/registry",
    auth: "public",
    method: "GET",
    summary: "List the current public tool registry for UI and external consumers.",
  },
  {
    path: "/api/v1/platform",
    auth: "public",
    method: "GET",
    summary: "Fetch Ark's machine-readable platform contract.",
  },
  {
    path: "/api/v1/files",
    auth: "api_key",
    method: "POST",
    summary: "Upload source files for execution and artifact delivery.",
  },
  {
    path: "/api/v1/execute",
    auth: "api_key",
    method: "POST",
    summary: "Run a tool synchronously and return the result inline.",
  },
  {
    path: "/api/v1/execute/async",
    auth: "api_key",
    method: "POST",
    summary: "Create an async execution job for longer-running work.",
  },
  {
    path: "/api/v1/jobs/{jobId}",
    auth: "api_key",
    method: "GET",
    summary: "Poll async execution status and retrieve terminal results.",
  },
  {
    path: "/api/v1/admin/managed-tenants",
    auth: "api_key",
    method: "POST",
    summary:
      "Platform-operator endpoint for managed Ark-key mode. Create a tenant and issue its tenant-facing Ark key in one step.",
  },
  {
    path: "/api/v1/admin/managed-tenants",
    auth: "api_key",
    method: "GET",
    summary:
      "Platform-operator endpoint for listing managed tenants and their current key counts.",
  },
  {
    path: "/api/v1/admin/managed-tenants/{tenantId}",
    auth: "api_key",
    method: "GET",
    summary:
      "Platform-operator endpoint for inspecting one managed tenant, including current keys and recent usage.",
  },
  {
    path: "/api/v1/admin/managed-tenants/{tenantId}",
    auth: "api_key",
    method: "PATCH",
    summary:
      "Platform-operator endpoint for updating managed-tenant status or default quota.",
  },
  {
    path: "/api/v1/admin/managed-tenants/{tenantId}/keys",
    auth: "api_key",
    method: "POST",
    summary:
      "Platform-operator endpoint for minting or rotating a tenant-facing Ark key in managed mode.",
  },
  {
    path: "/api/v1/admin/managed-tenants/{tenantId}/keys/{keyId}",
    auth: "api_key",
    method: "DELETE",
    summary:
      "Platform-operator endpoint for revoking a tenant-facing Ark key in managed mode.",
  },
  {
    path: "/api/v1/admin/api-keys",
    auth: "api_key",
    method: "GET",
    summary:
      "Operator-only endpoint for listing deployment API keys in a self-hosted Ark environment.",
  },
  {
    path: "/api/v1/admin/api-keys",
    auth: "api_key",
    method: "POST",
    summary:
      "Operator-only endpoint for creating scoped deployment API keys without restarting the server.",
  },
  {
    path: "/api/v1/admin/api-keys/{keyId}",
    auth: "api_key",
    method: "DELETE",
    summary:
      "Operator-only endpoint for revoking locally managed deployment API keys.",
  },
  {
    path: "/api/v1/admin/tenants",
    auth: "api_key",
    method: "GET",
    summary:
      "Platform-operator endpoint for listing self-hosted tenants and their default quota policies.",
  },
  {
    path: "/api/v1/admin/tenants",
    auth: "api_key",
    method: "POST",
    summary:
      "Platform-operator endpoint for creating a tenant and issuing its bootstrap key.",
  },
  {
    path: "/api/v1/admin/tenants/{tenantId}",
    auth: "api_key",
    method: "GET",
    summary:
      "Platform-operator endpoint for inspecting a tenant configuration.",
  },
  {
    path: "/api/v1/admin/tenants/{tenantId}",
    auth: "api_key",
    method: "PATCH",
    summary:
      "Platform-operator endpoint for updating tenant status or default quota in self-hosted mode.",
  },
];

const countBy = <T extends string>(items: T[]): Array<{ id: T; count: number }> => {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
};

export const getPlatformContract = () => {
  const manifests = getToolManifests();
  const categoryBreakdown = countBy(manifests.map((manifest) => manifest.category));
  const outputBreakdown = countBy(manifests.map((manifest) => manifest.output_type));
  const asyncRecommendedTools = manifests
    .filter(
      (manifest) =>
        manifest.category === "video" ||
        manifest.category === "pdf" ||
        manifest.id.startsWith("media.") ||
        manifest.id.endsWith(".summary"),
    )
    .map((manifest) => manifest.id)
    .slice(0, 16);

  return {
    version: "2026-03-10",
    brand: {
      name: "Ark",
      consumer_slogan_zh: "\u4e00\u53e5\u8bdd\u5c31\u5b8c\u4e8b\u3002",
      consumer_subtitle_zh:
        "\u6211\u4eec\u4e0d\u62a2\u5360\u7528\u6237\u5fc3\u667a\uff0c\u6211\u4eec\u628a\u6ce8\u610f\u529b\u8fd8\u7ed9\u4f60\u7684\u624b\u91cc\u3002",
      api_slogan_zh:
        "\u4e00\u6b21\u63a5\u5165\uff0c\u7acb\u523b\u83b7\u5f97\u6574\u4e2a Ark \u5de5\u5177\u76ee\u5f55\u3002",
      api_subtitle_zh:
        "\u628a\u7406\u89e3\u4ea4\u7ed9 agent\uff0c\u628a\u4e0b\u8f7d\u3001\u8f6c\u5199\u3001\u8f6c\u6362\u3001\u5904\u7406\u8fd9\u4e9b\u6267\u884c\u4efb\u52a1\u4ea4\u7ed9 Ark\u3002",
    },
    thesis: {
      consumer:
        "Island and Web are consumer-facing products powered by one shared backend capability layer.",
      api:
        "Ark's API is for enterprises and agents that want deterministic execution, async jobs, and artifact delivery instead of wasting model tokens on tool work.",
    },
    products: surfaces,
    service_modes: serviceModes,
    tool_catalog: {
      total_tools: TOOL_COUNT,
      headline:
        "Ark exposes the whole current catalog through one deployment key today and is being productized toward a 100+ deterministic-tool platform.",
      category_breakdown: categoryBreakdown,
      output_breakdown: outputBreakdown,
    },
    auth: {
      model: "one_api_key_per_tenant",
      accepted_headers: ["X-API-Key", "Authorization: Bearer <key>"],
      required_scopes: ["execute:read", "execute:write", "runs:read"],
      note:
        "In self-hosted BYOK mode, operators control the provider env and issue deployment API keys themselves. In managed_ark_key mode, platform operators can also issue tenant-facing Ark keys that execute against the shared backend without exposing provider keys in the client request.",
    },
    execution: {
      sync: true,
      async: true,
      artifacts: artifactTypes,
      async_recommended_tools: asyncRecommendedTools,
      value_props: [
        "deterministic execution",
        "artifact-first delivery",
        "token savings for upstream agents",
        "shared backend across Island, Web, and API",
      ],
    },
    endpoints,
    integrations,
    current_boundaries: {
      video_subtitles: {
        status: "partial",
        remote_link_subtitles:
          "Remote subtitle extraction is validated for Bilibili, YouTube, Douyin, and direct downloadable video URLs. The flow prefers platform subtitles when available, falls back to ASR when needed, and returns unified txt/srt/vtt artifacts.",
        local_video_transcription:
          "Local uploaded videos now have a one-step video.transcribe_subtitle flow that returns transcript, txt, srt, vtt, and a subtitle bundle artifact.",
        youtube:
          "YouTube subtitle extraction is live for self-hosted deployments. Direct reachability is preferred; MEDIA_PROXY or HTTPS_PROXY can be supplied when the host needs a proxy.",
        xiaohongshu:
          "Xiaohongshu runs through the same unified tool path. The bridge endpoint is deployment-configurable, and unattended execution succeeds when either a tenant XHS connection or OMNIAGENT_XHS_COOKIE is present. Otherwise the tool now reports a precise auth/bridge boundary.",
      },
    },
  };
};

export type PlatformContract = ReturnType<typeof getPlatformContract>;
