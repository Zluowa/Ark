// @input: ToolManifest + ToolHandler from callers
// @output: Singleton tool registry with CRUD and search
// @position: Central store for all registered tools in the v5 engine

import type {
  ToolManifest,
  ToolHandler,
  ToolRegistryEntry,
  ToolCategory,
} from "./types";

type ListOptions = {
  category?: ToolCategory;
  search?: string;
};

class ToolRegistry {
  private readonly store = new Map<string, ToolRegistryEntry>();

  register(manifest: ToolManifest, handler: ToolHandler, timeout?: number): void {
    this.store.set(manifest.id, { manifest, handler, timeout });
  }

  get(toolId: string): ToolRegistryEntry | undefined {
    return this.store.get(toolId);
  }

  list(options: ListOptions = {}): ToolManifest[] {
    const results: ToolManifest[] = [];
    const { category, search } = options;
    const query = search?.toLowerCase().trim();

    for (const { manifest } of this.store.values()) {
      if (category && manifest.category !== category) continue;
      if (query && !matchesSearch(manifest, query)) continue;
      results.push(manifest);
    }

    return results.sort((a, b) => a.id.localeCompare(b.id));
  }

  search(query: string): ToolManifest[] {
    return this.list({ search: query });
  }
}

const matchesSearch = (manifest: ToolManifest, query: string): boolean => {
  const haystack = [
    manifest.id,
    manifest.name,
    manifest.description,
    manifest.tags.join(" "),
    manifest.keywords.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
};

export const toolRegistry = new ToolRegistry();
