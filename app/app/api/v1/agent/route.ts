// @input: natural language query from agent page
// @output: routed tool execution result
// @position: C-end agent API — bridges v5 engine for interactive use

import { NextRequest, NextResponse } from "next/server";
import { initEngine } from "@/lib/engine/init";
import { routeIntent } from "@/lib/engine/router";
import { execute } from "@/lib/engine/runner";
import { toolRegistry } from "@/lib/engine/registry";

const MIN_CONFIDENCE = 0.4;

// Tools that only need `input` param — derive it from the full query
const INPUT_PARAM_CATEGORIES = new Set(["hash", "encode", "convert"]);

// Extract the most useful param value from the query
// Strategy: strip known keywords, use the remainder as `input`
const extractParams = (
  toolId: string,
  query: string,
): Record<string, unknown> => {
  const entry = toolRegistry.get(toolId);
  if (!entry) return {};

  const { manifest } = entry;
  const params: Record<string, unknown> = {};

  // Net tools: extract domain or IP
  if (toolId === "net.dns-lookup") {
    const match = query.match(/(?:dns|lookup|resolve)\s+(\S+)/i);
    params.domain = match?.[1] ?? query.split(/\s+/).pop() ?? query;
    return params;
  }

  if (toolId === "net.ip-info") {
    const match = query.match(/(?:ip|info|whois)\s+(\S+)/i);
    params.ip = match?.[1] ?? query.split(/\s+/).pop() ?? query;
    return params;
  }

  // Generate tools need no input params
  if (manifest.category === "generate") {
    const lengthMatch = query.match(/\b(\d+)\b/);
    if (lengthMatch && toolId === "generate.password") {
      params.length = Number(lengthMatch[1]);
    }
    return params;
  }

  // For hash/encode/convert: strip tool keywords and use the rest
  if (INPUT_PARAM_CATEGORIES.has(manifest.category)) {
    const keywords = [...manifest.keywords, manifest.id.split(".")[1]];
    let stripped = query;
    for (const kw of keywords) {
      stripped = stripped.replace(new RegExp(`\\b${kw}\\b`, "gi"), "").trim();
    }
    params.input = stripped || query;
    return params;
  }

  return params;
};

export async function POST(request: NextRequest) {
  let query: string;
  try {
    const body = await request.json();
    query = String(body?.query ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  initEngine();

  const matches = routeIntent(query);
  const best = matches[0];

  if (!best || best.confidence < MIN_CONFIDENCE) {
    return NextResponse.json({
      status: "no_match",
      query,
      suggestions: matches.map((m) => m.tool_id),
    });
  }

  const params = extractParams(best.tool_id, query);
  const startedAt = Date.now();
  const result = await execute(best.tool_id, params);

  const entry = toolRegistry.get(best.tool_id);

  return NextResponse.json({
    status: result.status,
    tool_id: best.tool_id,
    tool_name: entry?.manifest.name ?? best.tool_id,
    confidence: best.confidence,
    method: best.method,
    result,
    duration_ms: Date.now() - startedAt,
    error: result.error,
  });
}
