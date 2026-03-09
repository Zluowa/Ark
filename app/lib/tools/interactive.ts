// @input: None (interactive widgets run entirely in the browser)
// @output: Pass-through tool entries for client-side-only widgets
// @position: Manifests that expose interactive widgets on the Tools page

import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";
import { FAST_TIMEOUT_MS } from "@/lib/engine/types";

const ok = (data: Record<string, unknown>, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "success", output: data, duration_ms: Date.now() - start });

const passthrough: ToolHandler = async (params) => ok({ ...params }, Date.now());

// ── Helper ──────────────────────────────────────────────────────────────

function entry(manifest: ToolManifest, handler: ToolHandler = passthrough): ToolRegistryEntry {
  return { manifest, handler, timeout: FAST_TIMEOUT_MS };
}

// ── Manifests ───────────────────────────────────────────────────────────

export const generateWhiteboard = entry({
  id: "generate.whiteboard", name: "Whiteboard",
  description: "Open an infinite drawing canvas for freehand sketching",
  category: "generate", tags: ["whiteboard", "draw", "sketch"],
  params: [],
  output_type: "json",
  keywords: ["whiteboard", "draw", "sketch", "白板", "画板"],
  patterns: ["white.*board", "sketch.*pad", "白板"],
});

export const generatePomodoro = entry({
  id: "generate.pomodoro", name: "Pomodoro Timer",
  description: "Start a focus timer with customizable work/break intervals",
  category: "generate", tags: ["pomodoro", "timer", "focus"],
  params: [
    { name: "minutes", type: "number", required: false, default: 25, min: 1, max: 120, description: "Work minutes" },
  ],
  output_type: "json",
  keywords: ["pomodoro", "focus", "timer", "番茄钟", "专注"],
  patterns: ["pomodoro", "focus.*timer", "番茄钟"],
});

export const generateChart = entry({
  id: "generate.chart", name: "Chart Builder",
  description: "Create interactive charts — bar, line, pie, scatter, and more",
  category: "generate", tags: ["chart", "graph", "visualization"],
  params: [
    { name: "chart_type", type: "string", required: false, default: "bar", description: "Chart type" },
  ],
  output_type: "json",
  keywords: ["chart", "graph", "bar", "pie", "line", "图表", "柱状图"],
  patterns: ["chart", "graph", "visualiz", "图表"],
});

export const generateDiagram = entry({
  id: "generate.diagram", name: "Diagram Editor",
  description: "Create and edit Mermaid diagrams — flowcharts, sequence diagrams, etc.",
  category: "generate", tags: ["mermaid", "diagram", "flowchart"],
  params: [
    { name: "diagram", type: "string", required: false, default: "graph TD\n  A[Start] --> B[End]", description: "Mermaid syntax" },
  ],
  output_type: "json",
  keywords: ["mermaid", "diagram", "flowchart", "sequence", "流程图"],
  patterns: ["mermaid", "diagram", "流程图"],
});

export const generateFlow = entry({
  id: "generate.flow", name: "Flow Editor",
  description: "Build node-based flow diagrams with drag-and-drop",
  category: "generate", tags: ["flow", "node", "editor"],
  params: [],
  output_type: "json",
  keywords: ["flow", "node", "pipeline", "流程编辑", "节点"],
  patterns: ["flow.*editor", "node.*editor", "pipeline"],
});

export const generateCanvas = entry({
  id: "generate.canvas", name: "Vector Canvas",
  description: "Open a tldraw vector drawing canvas for diagrams and illustrations",
  category: "generate", tags: ["tldraw", "canvas", "vector"],
  params: [],
  output_type: "json",
  keywords: ["tldraw", "canvas", "vector", "illustration", "矢量画布"],
  patterns: ["tldraw", "vector.*canvas", "矢量"],
});

export const generateDocument = entry({
  id: "generate.document", name: "Block Editor",
  description: "Rich block-based document editor with slash commands",
  category: "generate", tags: ["editor", "document", "block"],
  params: [],
  output_type: "json",
  keywords: ["block", "editor", "document", "notion", "文档编辑"],
  patterns: ["block.*editor", "rich.*editor", "文档"],
});

export const generateWriting = entry({
  id: "generate.writing", name: "Writing Editor",
  description: "Distraction-free writing editor with AI-assisted features",
  category: "generate", tags: ["writing", "novel", "editor"],
  params: [],
  output_type: "json",
  keywords: ["writing", "novel", "editor", "prose", "写作"],
  patterns: ["writing.*editor", "novel.*editor", "写作"],
});

export const generateGraph = entry({
  id: "generate.graph", name: "Graph Viewer",
  description: "Visualize network graphs with nodes and edges",
  category: "generate", tags: ["graph", "network", "visualization"],
  params: [],
  output_type: "json",
  keywords: ["graph", "network", "sigma", "知识图谱", "关系图"],
  patterns: ["graph.*view", "network.*view", "知识图谱"],
});

export const generateToolkit = entry({
  id: "generate.toolkit", name: "UI Toolkit",
  description: "Interactive UI component toolkit — color picker, calculators, and more",
  category: "generate", tags: ["toolkit", "ui", "components"],
  params: [],
  output_type: "json",
  keywords: ["toolkit", "ui", "component", "mantine", "工具箱"],
  patterns: ["toolkit", "ui.*tool", "工具箱"],
});

export const generateUniver = entry({
  id: "generate.univer", name: "Univer Spreadsheet",
  description: "Excel-grade spreadsheet with formulas, charts, and pivot tables",
  category: "generate", tags: ["spreadsheet", "excel", "univer"],
  params: [],
  output_type: "json",
  keywords: ["univer", "excel", "spreadsheet", "pivot", "高级表格"],
  patterns: ["univer", "excel.*grade", "高级表格"],
});

export const generateDashboard = entry({
  id: "generate.dashboard", name: "Data Dashboard",
  description: "Build a data dashboard with KPIs, charts, and tables",
  category: "generate", tags: ["dashboard", "analytics", "kpi"],
  params: [],
  output_type: "json",
  keywords: ["dashboard", "analytics", "kpi", "tremor", "仪表盘"],
  patterns: ["dashboard", "analytics", "仪表盘"],
});

export const devRunCode = entry({
  id: "dev.run_code", name: "Code Playground",
  description: "Write and run JavaScript code in a sandboxed playground",
  category: "generate", tags: ["code", "javascript", "playground"],
  params: [
    { name: "code", type: "string", required: false, default: "console.log('Hello!')", description: "Initial code" },
  ],
  output_type: "json",
  keywords: ["code", "playground", "javascript", "run", "代码运行"],
  patterns: ["code.*play", "run.*code", "代码"],
});

export const devDiff = entry({
  id: "dev.diff", name: "Diff Viewer",
  description: "Compare text differences with a side-by-side or unified diff view",
  category: "generate", tags: ["diff", "compare", "code"],
  params: [
    { name: "diff", type: "string", required: false, default: "--- a/old\n+++ b/new\n@@ -1 +1 @@\n-old\n+new", description: "Unified diff" },
  ],
  output_type: "json",
  keywords: ["diff", "compare", "code review", "差异对比"],
  patterns: ["diff", "compare", "差异"],
});

export const devSandbox = entry({
  id: "dev.sandbox", name: "Live Sandbox",
  description: "Interactive React sandbox powered by Sandpack — edit and preview live",
  category: "generate", tags: ["sandbox", "react", "sandpack"],
  params: [],
  output_type: "json",
  keywords: ["sandbox", "sandpack", "react", "live", "沙箱"],
  patterns: ["sandbox", "sandpack", "live.*code", "沙箱"],
});
