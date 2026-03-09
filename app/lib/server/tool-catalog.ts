// @input: v5 engine tool registry
// @output: ToolSummary[], ToolDetail for API consumers
// @position: Compatibility adapter — delegates to v5 engine, keeps old interface

import { initEngine } from "@/lib/engine/init";
import { toolRegistry } from "@/lib/engine/registry";
import type { ToolManifest } from "@/lib/engine/types";

export type ToolSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  runtime: { language?: string; timeout?: number; memory?: string };
};

export type ToolDetail = ToolSummary & {
  manifest: ToolManifest;
  hasExecutor: boolean;
  testCaseCount: number;
};

type ListToolsOptions = {
  query?: string;
  limit?: number;
};

const toSummary = (manifest: ToolManifest): ToolSummary => ({
  id: manifest.id,
  name: manifest.name,
  version: "1.0.0",
  description: manifest.description,
  tags: manifest.tags,
  runtime: { language: "typescript" },
});

export const listTools = (options: ListToolsOptions = {}): ToolSummary[] => {
  initEngine();
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const manifests = toolRegistry.list({ search: options.query });
  return manifests.map(toSummary).slice(0, limit);
};

export const getToolById = (toolId: string): ToolDetail | undefined => {
  const normalized = toolId.trim();
  if (!normalized) return undefined;
  initEngine();
  const entry = toolRegistry.get(normalized);
  if (!entry) return undefined;
  return {
    ...toSummary(entry.manifest),
    manifest: entry.manifest,
    hasExecutor: true,
    testCaseCount: 0,
  };
};
