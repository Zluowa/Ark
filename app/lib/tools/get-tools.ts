// @input: allTools from v5 engine (ToolRegistryEntry[])
// @output: ToolDisplay[] and ToolManifest[] shaped for UI consumption
// @position: Server-side data access; import only in Server Components or API routes

import { allTools } from "@/lib/tools";
import type { ToolDisplay } from "@/lib/tools/display";
import type { ToolManifest } from "@/lib/engine/types";

export function getToolsForDisplay(): ToolDisplay[] {
  return allTools.map(({ manifest: m }) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    tags: m.tags,
    paramCount: m.params.length,
    outputType: m.output_type,
  }));
}

export function getToolManifests(): ToolManifest[] {
  return allTools.map(({ manifest }) => manifest);
}

export const TOOL_COUNT = allTools.length;
