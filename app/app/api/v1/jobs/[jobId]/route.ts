import { toolJobRegistry } from "@/lib/server/job-registry";
import {
  authorizeRequest,
  canAccessTenant,
  tenantBlockedResponse,
} from "@/lib/server/access-control";
import { toResponse } from "@/lib/shared/result";

type ParamsContext = {
  params: Promise<unknown>;
};

export async function GET(req: Request, context: ParamsContext) {
  const access = authorizeRequest(req, "runs:read");
  if (!access.ok) {
    return toResponse(access);
  }

  const { jobId } = (await context.params) as { jobId?: string };
  if (!jobId) {
    return Response.json(
      {
        error: {
          code: "bad_request",
          message: "Missing job id",
        },
      },
      { status: 400 },
    );
  }

  const decodedJobId = decodeURIComponent(jobId);
  const job = await toolJobRegistry.get(decodedJobId);
  if (!job) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: `Job not found: ${decodedJobId}`,
        },
      },
      { status: 404 },
    );
  }
  if (!canAccessTenant(access.identity, job.tenantId)) {
    return tenantBlockedResponse("Job", decodedJobId);
  }

  return Response.json({
    job_id: job.jobId,
    run_id: job.runId,
    tool: job.tool,
    status: job.status,
    progress: job.progress,
    eta_ms: job.etaMs,
    result: job.result,
    error: job.error,
    started_at: job.startedAt,
    completed_at: job.completedAt,
    duration_ms: job.durationMs,
  });
}
