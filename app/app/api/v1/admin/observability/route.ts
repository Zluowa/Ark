import { authorizeRequest } from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";
import { redactSecret, getServerEnv } from "@/lib/server/env";
import {
  getSloSnapshot,
  listRecentAlertSamples,
  listRecentApiSamples,
  withObservedRequest,
} from "@/lib/server/observability";
import { listAuditEvents } from "@/lib/server/security-controls";

const parseLimit = (req: Request): number => {
  const raw = new URL(req.url).searchParams.get("limit");
  if (!raw) {
    return 50;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
};

export async function GET(req: Request) {
  return withObservedRequest(req, {
    route: "/api/v1/admin/observability",
    handler: async (observation) => {
      const access = authorizeRequest(req, "admin:*");
      if (!access.ok) {
        return toResponse(access);
      }
      observation.setIdentity(access.identity);

      const env = getServerEnv();
      const limit = parseLimit(req);

      return Response.json({
        ok: true,
        snapshot: getSloSnapshot(),
        recent_requests: listRecentApiSamples(limit),
        recent_alerts: listRecentAlertSamples(limit),
        recent_audit: listAuditEvents({ limit }),
        config: {
          audit_log_max_entries: env.auditLogMaxEntries,
          auth_mode: env.authMode,
          relay_base_url: env.relayBaseUrl,
          relay_api_key: redactSecret(env.relayApiKey),
          security_json_max_bytes: env.securityJsonBodyMaxBytes,
          security_multipart_max_bytes: env.securityMultipartBodyMaxBytes,
          security_write_rate_per_minute: env.securityWriteRateLimitPerMinute,
        },
      });
    },
  });
}
