// @input: GET request with query params (since, limit, action, tenantId), admin:* scope required
// @output: { events: AuditEvent[], total: number } — paginated audit log query
// @position: admin API endpoint — reads from audit-store (JSONL local or Postgres)

import { authorizeRequest } from "@/lib/server/access-control";
import { auditStore } from "@/lib/server/audit-store";
import { withObservedRequest } from "@/lib/server/observability";
import { toResponse } from "@/lib/shared/result";
import { err } from "@/lib/shared/result";

const parseQueryParams = (req: Request) => {
  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const limitRaw = url.searchParams.get("limit");
  const action = url.searchParams.get("action")?.trim() || undefined;
  const tenantId = url.searchParams.get("tenant_id")?.trim() || undefined;

  const since = sinceRaw ? Date.parse(sinceRaw) : undefined;
  if (sinceRaw && (since === undefined || !Number.isFinite(since))) {
    return { ok: false as const, error: "Invalid `since` date format. Use ISO 8601." };
  }

  const limitParsed = limitRaw ? Number(limitRaw) : 100;
  const limit = Number.isFinite(limitParsed)
    ? Math.max(1, Math.min(500, Math.floor(limitParsed)))
    : 100;

  return { ok: true as const, since, limit, action, tenantId };
};

export async function GET(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/audit",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) return toResponse(access);
      observation.setIdentity(access.identity);

      const params = parseQueryParams(req);
      if (!params.ok) {
        return toResponse(err("invalid_query_params", params.error, 400));
      }

      const events = await auditStore.list({
        action: params.action,
        limit: params.limit,
        since: params.since,
        tenantId: params.tenantId,
      });

      return Response.json({ ok: true, events, total: events.length });
    },
  });
}
