// @input: All tool modules from lib/tools/
// @output: Side-effect: registers all 40 tools into the singleton registry
// @position: Bootstrap — import once at server startup or in API routes

import { toolRegistry } from "./registry";
import { allTools } from "@/lib/tools";

let initialized = false;

export const initEngine = (): void => {
  if (initialized) return;
  initialized = true;
  for (const tool of allTools) {
    toolRegistry.register(tool.manifest, tool.handler, tool.timeout);
  }
};
