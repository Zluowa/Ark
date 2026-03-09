// @input: None (static data)
// @output: Default mock results for interactive widgets in standalone mode
// @position: Data layer for tool-standalone.tsx

const futureDate = (days: number) => new Date(Date.now() + 86400000 * days).toISOString();

export const TOOL_DEFAULTS: Record<string, Record<string, unknown>> = {
  // ── Interactive apps ──
  generate_kanban: { json: { title: "My Board", columns: [{ name: "Todo", cards: [] }, { name: "In Progress", cards: [] }, { name: "Done", cards: [] }] } },
  generate_whiteboard: {},
  generate_excalidraw: { json: { topic: "Draw" } },
  generate_pomodoro: { minutes: 25, label: "Focus" },
  generate_countdown: { json: { target: futureDate(7), label: "Countdown" } },
  generate_habits: { json: { habits: [{ name: "Exercise", color: "#22c55e" }, { name: "Read", color: "#3b82f6" }, { name: "Code", color: "#ec4899" }] } },
  generate_flashcards: { json: { title: "Flashcards", cards: [{ front: "Click + to add", back: "Flip to see answer" }] } },
  generate_worldclock: { json: { cities: [{ name: "New York", timezone: "America/New_York" }, { name: "London", timezone: "Europe/London" }, { name: "Beijing", timezone: "Asia/Shanghai" }, { name: "Tokyo", timezone: "Asia/Tokyo" }] } },
  generate_spreadsheet: { json: { title: "Sheet", headers: ["A", "B", "C", "D"], rows: [["", "", "", ""], ["", "", "", ""], ["", "", "", ""]] } },
  generate_mindmap: { json: { center: "Topic", branches: [{ label: "Idea 1", children: ["Detail"] }, { label: "Idea 2", children: ["Detail"] }] } },

  // ── Dev tools ──
  dev_run_code: { code: "// Write your code here\nconsole.log('Hello!');", language: "javascript" },
  convert_md_html: { markdown: "# Hello\n\nStart writing...", html: "<h1>Hello</h1><p>Start writing...</p>" },
  dev_diff: { diff: "--- a/old.txt\n+++ b/new.txt\n@@ -1 +1 @@\n-old line\n+new line" },
  generate_diagram: { diagram: "graph TD\n  A[Start] --> B[End]" },
  dev_diagram: { diagram: "graph TD\n  A[Start] --> B[End]" },

  // ── Charts ──
  generate_chart: { chart_type: "bar", title: "Chart", data: { labels: ["A", "B", "C"], datasets: [{ name: "Series", values: [10, 20, 30] }] } },

  // ── Open-source widgets ──
  generate_canvas: { topic: "Canvas" },
  tldraw_canvas: { topic: "Canvas" },
  generate_flow: { title: "Flow", nodes: [], edges: [] },
  flow_editor: { title: "Flow", nodes: [], edges: [] },
  block_editor: { title: "Document", markdown: "" },
  generate_document: { title: "Document", markdown: "" },
  novel_editor: { title: "Writing", content: "" },
  generate_writing: { title: "Writing", content: "" },
  sandpack_sandbox: { template: "react", files: { "/App.js": "export default function App() {\n  return <h1>Hello!</h1>;\n}" } },
  dev_sandbox: { template: "react", files: { "/App.js": "export default function App() {\n  return <h1>Hello!</h1>;\n}" } },
  mantine_toolkit: { type: "color" },
  generate_toolkit: { type: "color" },
  univer_sheet: { title: "Sheet", headers: ["A", "B", "C"], rows: [["", "", ""], ["", "", ""]] },
  generate_univer: { title: "Sheet", headers: ["A", "B", "C"], rows: [["", "", ""], ["", "", ""]] },
  tremor_dashboard: { title: "Dashboard", kpis: [], charts: [], tables: [] },
  generate_dashboard: { title: "Dashboard", kpis: [], charts: [], tables: [] },
  graph_viewer: { nodes: [], edges: [] },
  generate_graph: { nodes: [], edges: [] },
};
