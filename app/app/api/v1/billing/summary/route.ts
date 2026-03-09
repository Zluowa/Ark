import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { usageLedger } from "@/lib/server/usage-ledger";

const resolveTenantId = (req: Request, fallbackTenantId: string): string => {
  const url = new URL(req.url);
  const requested =
    url.searchParams.get("tenant_id")?.trim() ||
    url.searchParams.get("tenant")?.trim();
  if (!requested) {
    return fallbackTenantId;
  }

  return requested;
};

export async function GET(req: Request) {
  const access = authorizeRequest(req, "runs:read");
  if (!access.ok) {
    return toResponse(access);
  }

  const tenantId = resolveTenantId(req, access.identity.tenantId);

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
          message: "Cannot access billing summary for other tenants.",
        },
      },
      { status: 403 },
    );
  }

  const summary = await usageLedger.summarize(tenantId);
  return Response.json({
    ok: true,
    summary,
  });
}
