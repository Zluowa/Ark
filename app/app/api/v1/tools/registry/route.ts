// @input: v5 engine tool registry (allTools)
// @output: JSON array of tool manifests with display metadata
// @position: Public tool listing API — no auth required, used by UI and external consumers

import { getToolsForDisplay, TOOL_COUNT } from "@/lib/tools/get-tools";

export const dynamic = "force-static";

export function GET() {
  const tools = getToolsForDisplay();
  return Response.json({ tools, total: TOOL_COUNT });
}
