import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { usageLedger } from "@/lib/server/usage-ledger";

const parseLimit = (url: URL): number => {
  const raw = url.searchParams.get("limit");
  if (!raw) return 100;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
};

const resolveTenantId = (url: URL, fallbackTenantId: string): string => {
  return (
    url.searchParams.get("tenant_id")?.trim() ||
    url.searchParams.get("tenant")?.trim() ||
    fallbackTenantId
  );
};

export async function GET(req: Request) {
  const access = authorizeRequest(req, "runs:read");
  if (!access.ok) {
    return toResponse(access);
  }

  const url = new URL(req.url);
  const tenantId = resolveTenantId(url, access.identity.tenantId);
  const isAdmin = access.identity.scopes.has("admin:*");
  if (
    tenantId !== access.identity.tenantId &&
    !isAdmin &&
    !access.identity.trustedLocal
  ) {
    return Response.json(
      {
        error: {
          code: "auth_forbidden_scope",
          message: "Cannot access billing usage for other tenants.",
        },
      },
      { status: 403 },
    );
  }

  const runId = url.searchParams.get("run_id")?.trim() || undefined;
  const usage = await usageLedger.listRecent({
    limit: parseLimit(url),
    runId,
    tenantId,
  });

  return Response.json({
    ok: true,
    count: usage.length,
    usage,
  });
}
