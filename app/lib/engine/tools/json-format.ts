// @input: params.text (raw JSON string) + optional params.indent
// @output: ExecuteResult with formatted JSON text
// @position: JSON formatting tool — sample for v5 engine

import type { ToolManifest, ToolHandler } from "../types";

export const manifest: ToolManifest = {
  id: "util.json-format",
  name: "JSON Formatter",
  description: "Formats and validates a JSON string with configurable indent.",
  category: "encode",
  tags: ["json", "format", "pretty-print", "validate"],
  params: [
    {
      name: "text",
      type: "string",
      required: true,
      description: "Raw JSON string to format",
    },
    {
      name: "indent",
      type: "number",
      required: false,
      default: 2,
      description: "Number of spaces for indentation (1-8)",
      min: 1,
      max: 8,
    },
  ],
  output_type: "json",
  keywords: ["json", "format", "pretty", "indent", "validate", "parse"],
  patterns: ["format.*json", "pretty.?print", "json.*format"],
};

export const handler: ToolHandler = async (params) => {
  const text = String(params.text ?? "");
  const indent = Math.max(1, Math.min(8, Number(params.indent ?? 2)));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      status: "failed",
      error: { code: "invalid_json", message: "Input is not valid JSON" },
      duration_ms: 1,
    };
  }

  const formatted = JSON.stringify(parsed, null, indent);
  return {
    status: "success",
    output: {
      formatted,
      line_count: formatted.split("\n").length,
      char_count: formatted.length,
    },
    duration_ms: 1,
  };
};
