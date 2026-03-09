// @input: nothing — reads process.uptime() from Node runtime
// @output: JSON health payload { status, version, uptime, timestamp }
// @position: Public liveness probe — no auth, hit by load balancers and monitoring

const VERSION = "0.3.0";

export async function GET() {
  return Response.json({
    status: "ok",
    version: VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}
