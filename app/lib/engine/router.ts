// @input: Query string + tool registry
// @output: RouteMatch array ordered by confidence
// @position: 3-layer zero-token intent router for the v5 engine

import type { RouteMatch } from "./types";
import { toolRegistry } from "./registry";

const MAX_RESULTS = 5;
const patternCache = new Map<string, RegExp>();

const cachedRegExp = (pattern: string): RegExp | null => {
  const cached = patternCache.get(pattern);
  if (cached) return cached;
  try {
    const re = new RegExp(pattern, "i");
    patternCache.set(pattern, re);
    return re;
  } catch {
    return null;
  }
};

const matchExact = (query: string): RouteMatch | undefined => {
  const entry = toolRegistry.get(query);
  if (!entry) return undefined;
  return { tool_id: query, confidence: 1.0, method: "exact", tokens_used: 0 };
};

const matchKeywords = (query: string): RouteMatch[] => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];

  const results: RouteMatch[] = [];
  for (const manifest of toolRegistry.list()) {
    const keywordSet = new Set(manifest.keywords.map((k) => k.toLowerCase()));
    const matched = words.filter((w) => keywordSet.has(w)).length;
    if (matched === 0) continue;
    const confidence = Math.min(0.95, 0.5 + (matched / words.length) * 0.45);
    results.push({
      tool_id: manifest.id,
      confidence,
      method: "keyword",
      tokens_used: 0,
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
};

const matchPatterns = (query: string): RouteMatch[] => {
  const results: RouteMatch[] = [];
  for (const manifest of toolRegistry.list()) {
    for (const pattern of manifest.patterns) {
      const re = cachedRegExp(pattern);
      if (re?.test(query)) {
        results.push({
          tool_id: manifest.id,
          confidence: 0.8,
          method: "pattern",
          tokens_used: 0,
        });
        break;
      }
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence);
};

const dedup = (matches: RouteMatch[]): RouteMatch[] => {
  const seen = new Set<string>();
  return matches.filter(({ tool_id }) => {
    if (seen.has(tool_id)) return false;
    seen.add(tool_id);
    return true;
  });
};

export const routeIntent = (query: string): RouteMatch[] => {
  const normalized = query.trim();
  if (!normalized) return [];

  const exact = matchExact(normalized);
  if (exact) return [exact];

  const combined = [
    ...matchKeywords(normalized),
    ...matchPatterns(normalized),
  ];

  return dedup(combined).slice(0, MAX_RESULTS);
};
