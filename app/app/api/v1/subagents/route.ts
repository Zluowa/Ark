import { authorizeRequest, canAccessTenant } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { runRegistry } from "@/lib/server/run-registry";
import { subagentRegistry } from "@/lib/server/subagent-registry";

type SubagentListView = "active" | "recent";

const parseLimit = (url: URL): number | undefined => {
  const raw = url.searchParams.get("limit");
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
};

const parseView = (url: URL): SubagentListView => {
  const raw =
    url.searchParams.get("view")?.trim().toLowerCase() ||
    url.searchParams.get("filter")?.trim().toLowerCase() ||
    "";
  if (raw === "active") {
    return "active";
  }
  return "recent";
};

const isActiveStatus = (value: string | undefined): boolean => {
  return value === "accepted" || value === "running";
};

export async function GET(req: Request) {
  const access = authorizeRequest(req, "runs:read");
  if (!access.ok) {
    return toResponse(access);
  }

  const url = new URL(req.url);
  const view = parseView(url);
  const limit = parseLimit(url) ?? 50;
  const isAdmin = canAccessTenant(access.identity, undefined);
  const tenantId = isAdmin ? undefined : access.identity.tenantId;
  const candidates = await subagentRegistry.listRecent({
    limit: view === "active" ? Math.min(500, limit * 4) : limit,
    tenantId,
  });

  const decorated = await Promise.all(
    candidates.map(async (subagent) => {
      const run = await runRegistry.get(subagent.runId);
      return {
        id: subagent.id,
        run_id: subagent.runId,
        tool: subagent.tool,
        status: run?.status ?? "accepted",
        tenant_id: subagent.tenantId,
        api_key_id: subagent.apiKeyId,
        spawned_by: subagent.spawnedBy,
        spawn_depth: subagent.spawnDepth,
        effective_scopes: subagent.effectiveScopes,
        created_at: subagent.createdAt,
      };
    }),
  );

  const filtered =
    view === "active"
      ? decorated.filter((item) => isActiveStatus(item.status))
      : decorated;
  const subagents = filtered.slice(0, limit);

  return Response.json({
    ok: true,
    view,
    count: subagents.length,
    subagents,
  });
}
