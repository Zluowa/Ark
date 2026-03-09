// @input: Raw strings (JSON, YAML, CSV, Markdown)
// @output: Converted text in target format
// @position: Format conversion tools — pure computation, no I/O

import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";
import { FAST_TIMEOUT_MS } from "@/lib/engine/types";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/* ── Helpers ── */

const ok = (text: string, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "success", output: { text }, duration_ms: Date.now() - start });

const fail = (code: string, message: string, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "failed", error: { code, message }, duration_ms: Date.now() - start });

const str = (params: Record<string, unknown>, key: string) => String(params[key] ?? "");

/* ── 1. JSON → YAML ── */

const jsonToYamlManifest: ToolManifest = {
  id: "convert.json_yaml",
  name: "JSON to YAML",
  description: "Convert JSON string to YAML format",
  category: "convert",
  tags: ["json", "yaml", "convert", "format"],
  params: [{ name: "input", type: "string", required: true, description: "JSON string to convert" }],
  output_type: "text",
  keywords: ["json", "yaml", "convert", "转换", "格式转换"],
  patterns: ["json.*yaml", "convert.*json"],
};

const jsonToYamlHandler: ToolHandler = async (params) => {
  const start = Date.now();
  try {
    const obj = JSON.parse(str(params, "input"));
    return ok(stringifyYaml(obj), start);
  } catch {
    return fail("INVALID_JSON", "Input is not valid JSON", start);
  }
};

export const jsonToYaml: ToolRegistryEntry = { manifest: jsonToYamlManifest, handler: jsonToYamlHandler, timeout: FAST_TIMEOUT_MS };

/* ── 2. YAML → JSON ── */

const yamlToJsonManifest: ToolManifest = {
  id: "convert.yaml_json",
  name: "YAML to JSON",
  description: "Convert YAML string to JSON format",
  category: "convert",
  tags: ["yaml", "json", "convert", "format"],
  params: [{ name: "input", type: "string", required: true, description: "YAML string to convert" }],
  output_type: "text",
  keywords: ["yaml", "json", "convert", "转换", "格式转换"],
  patterns: ["yaml.*json", "convert.*yaml"],
};

const yamlToJsonHandler: ToolHandler = async (params) => {
  const start = Date.now();
  try {
    const obj = parseYaml(str(params, "input"));
    return ok(JSON.stringify(obj, null, 2), start);
  } catch {
    return fail("INVALID_YAML", "Input is not valid YAML", start);
  }
};

export const yamlToJson: ToolRegistryEntry = { manifest: yamlToJsonManifest, handler: yamlToJsonHandler, timeout: FAST_TIMEOUT_MS };

/* ── 3. JSON array → CSV ── */

const jsonToCsvManifest: ToolManifest = {
  id: "convert.json_csv",
  name: "JSON to CSV",
  description: "Convert JSON array to CSV format",
  category: "convert",
  tags: ["json", "csv", "convert", "tabular"],
  params: [{ name: "input", type: "string", required: true, description: "JSON array string to convert" }],
  output_type: "text",
  keywords: ["json", "csv", "convert", "转换", "表格"],
  patterns: ["json.*csv", "convert.*csv"],
};

const toCsvRow = (row: unknown[], headers: string[]) =>
  headers.map((h) => {
    const rowObj = typeof row === "object" && row !== null && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
    const val = rowObj[h] ?? "";
    const s = String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",");

const jsonToCsvHandler: ToolHandler = async (params) => {
  const start = Date.now();
  try {
    const arr = JSON.parse(str(params, "input"));
    if (!Array.isArray(arr) || arr.length === 0) return fail("INVALID_INPUT", "Input must be a non-empty JSON array", start);
    const headers = Object.keys(arr[0] as object);
    const rows = [headers.join(","), ...arr.map((row) => toCsvRow(row, headers))];
    return ok(rows.join("\n"), start);
  } catch {
    return fail("INVALID_JSON", "Input is not valid JSON", start);
  }
};

export const jsonToCsv: ToolRegistryEntry = { manifest: jsonToCsvManifest, handler: jsonToCsvHandler, timeout: FAST_TIMEOUT_MS };

/* ── 4. CSV → JSON array ── */

const csvToJsonManifest: ToolManifest = {
  id: "convert.csv_json",
  name: "CSV to JSON",
  description: "Convert CSV string to JSON array",
  category: "convert",
  tags: ["csv", "json", "convert", "tabular"],
  params: [{ name: "input", type: "string", required: true, description: "CSV string to convert" }],
  output_type: "text",
  keywords: ["csv", "json", "convert", "转换", "表格"],
  patterns: ["csv.*json", "parse.*csv"],
};

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
};

const csvToJsonHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const lines = str(params, "input").trim().split("\n").filter(Boolean);
  if (lines.length < 2) return fail("INVALID_INPUT", "CSV must have header + at least one row", start);
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
  return ok(JSON.stringify(rows, null, 2), start);
};

export const csvToJson: ToolRegistryEntry = { manifest: csvToJsonManifest, handler: csvToJsonHandler, timeout: FAST_TIMEOUT_MS };

/* ── 5. JSON format / minify ── */

const jsonFormatManifest: ToolManifest = {
  id: "convert.json_format",
  name: "JSON Format / Minify",
  description: "Pretty-print or minify a JSON string",
  category: "convert",
  tags: ["json", "format", "minify", "prettify"],
  params: [
    { name: "input", type: "string", required: true, description: "JSON string" },
    { name: "mode", type: "enum", required: false, default: "pretty", description: "Output mode", enum_values: ["pretty", "minify"] },
  ],
  output_type: "text",
  keywords: ["json", "format", "prettify", "minify", "格式化", "压缩"],
  patterns: ["format.*json", "prettify.*json", "minify.*json"],
};

const jsonFormatHandler: ToolHandler = async (params) => {
  const start = Date.now();
  try {
    const obj = JSON.parse(str(params, "input"));
    const mode = str(params, "mode") || "pretty";
    const result = mode === "minify" ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
    return ok(result, start);
  } catch {
    return fail("INVALID_JSON", "Input is not valid JSON", start);
  }
};

export const jsonFormat: ToolRegistryEntry = { manifest: jsonFormatManifest, handler: jsonFormatHandler, timeout: FAST_TIMEOUT_MS };

/* ── 6. Markdown → HTML ── */

const mdToHtmlManifest: ToolManifest = {
  id: "convert.md_html",
  name: "Markdown to HTML",
  description: "Convert Markdown text to HTML",
  category: "convert",
  tags: ["markdown", "html", "convert", "render"],
  params: [{ name: "input", type: "string", required: true, description: "Markdown string to convert" }],
  output_type: "text",
  keywords: ["markdown", "html", "convert", "渲染", "转换"],
  patterns: ["markdown.*html", "md.*html", "convert.*markdown"],
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const mdToHtmlHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const md = str(params, "input");
  const html = md
    .replace(/^#{6} (.+)$/gm, (_, t) => `<h6>${escapeHtml(t)}</h6>`)
    .replace(/^#{5} (.+)$/gm, (_, t) => `<h5>${escapeHtml(t)}</h5>`)
    .replace(/^#{4} (.+)$/gm, (_, t) => `<h4>${escapeHtml(t)}</h4>`)
    .replace(/^### (.+)$/gm, (_, t) => `<h3>${escapeHtml(t)}</h3>`)
    .replace(/^## (.+)$/gm, (_, t) => `<h2>${escapeHtml(t)}</h2>`)
    .replace(/^# (.+)$/gm, (_, t) => `<h1>${escapeHtml(t)}</h1>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[a-z])(.+)$/gm, "<p>$1</p>");
  return ok(html, start);
};

export const mdToHtml: ToolRegistryEntry = { manifest: mdToHtmlManifest, handler: mdToHtmlHandler, timeout: FAST_TIMEOUT_MS };
