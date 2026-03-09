// @input: None (test harness)
// @output: All A2UI widgets rendered with mock data for screenshot testing
// @position: Test page — /test-widgets

"use client";

import { TextResult } from "@/components/a2ui/text-result";
import { JsonResult } from "@/components/a2ui/json-result";
import { FileResult } from "@/components/a2ui/file-result";
import { ImageStudio } from "@/components/a2ui/image-studio";
import { ColorPalette } from "@/components/a2ui/color-palette";
import { QrCodeViewer } from "@/components/a2ui/qrcode-viewer";
import { JwtViewer } from "@/components/a2ui/jwt-viewer";
import { ChartBuilder } from "@/components/a2ui/chart-builder";
import { CodePlayground } from "@/components/a2ui/code-playground";
import { MarkdownEditor } from "@/components/a2ui/markdown-editor";
import { PdfViewer } from "@/components/a2ui/pdf-viewer";
import { DiffViewer } from "@/components/a2ui/diff-viewer";
import { TableResult } from "@/components/a2ui/table-result";
import { Whiteboard } from "@/components/a2ui/whiteboard";
import { PomodoroTimer } from "@/components/a2ui/pomodoro-timer";
import { MusicPlayer } from "@/components/a2ui/music-player";
import { MediaPlayer } from "@/components/a2ui/media-player";
import { MermaidViewer } from "@/components/a2ui/mermaid-viewer";
import { VideoDownloader } from "@/components/a2ui/video-downloader";
import { SubtitleViewer } from "@/components/a2ui/subtitle-viewer";
import { KanbanBoard } from "@/components/a2ui/kanban-board";
import { MindMap } from "@/components/a2ui/mind-map";
import { CountdownTimer } from "@/components/a2ui/countdown-timer";
import { HabitTracker } from "@/components/a2ui/habit-tracker";
import { FlashcardDeck } from "@/components/a2ui/flashcard-deck";
import { WorldClock } from "@/components/a2ui/world-clock";
import { ExcalidrawBoard } from "@/components/a2ui/excalidraw-board";
import { SpreadsheetGrid } from "@/components/a2ui/spreadsheet-grid";

// ── New widgets (10 open-source integrations) ──
import { TldrawCanvas } from "@/components/a2ui/tldraw-canvas";
import { FlowEditor } from "@/components/a2ui/flow-editor";
import { BlockEditor } from "@/components/a2ui/block-editor";
import { NovelEditor } from "@/components/a2ui/novel-editor";
import { SandpackSandbox } from "@/components/a2ui/sandpack-sandbox";
import { FileConverter } from "@/components/a2ui/file-converter";
import { UniverSheet } from "@/components/a2ui/univer-sheet";
import { TremorDashboard } from "@/components/a2ui/tremor-dashboard";
import { GraphViewer } from "@/components/a2ui/graph-viewer";
import { MantineToolkit } from "@/components/a2ui/mantine-toolkit";

const complete = { type: "complete" as const };

const Widget = ({ id, label, children }: { id: string; label: string; children: React.ReactNode }) => (
  <div id={id} className="mb-8">
    <h3 className="text-xs font-mono text-zinc-500 mb-2 px-1">{label}</h3>
    {children}
  </div>
);

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = (props: any) => props;

export default function TestWidgets() {
  return (
    <div className="min-h-screen bg-zinc-950 py-8 px-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-white mb-1">A2UI Widget Gallery</h1>
      <p className="text-sm text-zinc-500 mb-8">All 20 mini-apps rendered with mock data</p>

      {/* 1. Text Result */}
      <Widget id="w-text" label="1. TextResult — hash_md5">
        <TextResult {...P({ toolName: "hash_md5", status: complete, result: { text: "5d41402abc4b2a76b9719d911017c592", input: "hello" } })} />
      </Widget>

      {/* 2. JSON Result */}
      <Widget id="w-json" label="2. JsonResult — net_dns_lookup">
        <JsonResult {...P({ toolName: "net_dns_lookup", status: complete, result: { json: { domain: "google.com", A: ["142.250.80.46"], AAAA: ["2607:f8b0:4004:800::200e"], MX: ["smtp.google.com"], TTL: 300 }, text: "DNS lookup complete" } })} />
      </Widget>

      {/* 3. File Result */}
      <Widget id="w-file" label="3. FileResult — generic file">
        <FileResult {...P({ toolName: "file_download", status: complete, result: { output_url: "#", filename: "report-2026.xlsx", size_bytes: 2458624, pages: 12 } })} />
      </Widget>

      {/* 4. Image Studio */}
      <Widget id="w-image" label="4. ImageStudio — image_resize">
        <ImageStudio {...P({ toolName: "image_resize", status: complete, result: { output_url: "https://picsum.photos/400/300", name: "landscape.jpg", width: 400, height: 300, size: "128 KB" } })} />
      </Widget>

      {/* 5. Color Palette */}
      <Widget id="w-palette" label="5. ColorPalette — generate_color_palette">
        <ColorPalette {...P({ toolName: "generate_color_palette", status: complete, result: { json: { base: "#3B82F6", colors: ["#3B82F6", "#8B5CF6", "#EC4899", "#EF4444", "#F59E0B", "#22C55E", "#06B6D4"], count: 7 } } })} />
      </Widget>

      {/* 6. QR Code */}
      <Widget id="w-qr" label="6. QrCodeViewer — generate_qrcode">
        <QrCodeViewer {...P({ toolName: "generate_qrcode", status: complete, result: { output_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAAklEQVR4AewaftIAAAXJSURBVO3BUQ7jVhIEwayG7n/l2vlfQA8waZqazoj0DyStNEhaa5C01iBprUHSWoOktQZJaw2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK01SFrrw02SsFFb3iIJT2nLVUk4actJEjZqy1WDpLUGSWsNktYaJK01SFprkLTWIGmtQdJaHx7Ull+ShLdIwklb7pCEkyT8krb8kiQ8YZC01iBprUHSWoOktQZJaw2S1hokrTVIWuvDyyThCW15ShKuastJEk7actKWkySctOWXJOEJbXmLQdJag6S1BklrDZLWGiStNUhaa5C01iBprQ96hbZc1ZY7JOEOSfimLfpvDZLWGiStNUhaa5C01iBprUHSWoOktT7oFZJwVVue0parknDSFv17BklrDZLWGiStNUhaa5C01iBprUHSWoOktT68TFs2astVSThpy0lbTpJwVVvepC3bDJLWGiStNUhaa5C01iBprUHSWoOktQZJa314UBL0zyThpC0nSThpyx3a8k0STtpyhyTo/w2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWt9uElb9O9pyx3a8rdpi/6ZQdJag6S1BklrDZLWGiStNUhaa5C01iBprfQPbpCEk7acJOGXtOWXJOGkLb8kCb+kLW8xSFprkLTWIGmtQdJag6S1BklrDZLWGiSt9eEmbTlJwklbrkrCHdpyhySctOWbJNyhLSdJOGnLE5Jw0paTJJy05QlJOGnLEwZJaw2S1hokrTVIWmuQtNYgaa1B0lofbpKEOyThCW05ScJJW+6QhG/a8iZJeEJb3iQJ37TlDkk4actVg6S1BklrDZLWGiStNUhaa5C01iBprUHSWh9epi0nSbgqCSdteUpbvknCHdpyh7acJOEJSXhKW65qy0kSnjBIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK2V/sFDkvCEttwhCSdteYsk3KEtJ0m4qi0nSbhDW06ScNKWb5LwlLZcNUhaa5C01iBprUHSWoOktQZJaw2S1hokrZX+wQ2S8Eva8pQknLTlmySctOWXJOGkLXdIwklbTpLwTVtOknDSlicMktYaJK01SFprkLTWIGmtQdJag6S1BklrfXhQW35JEu7Qlick4Q5tuUMSvmnLHZJwhyS8RRJO2nLVIGmtQdJag6S1BklrDZLWGiStNUhaa5C01ocflIRv2nKHtpwk4QltOUnCSVvukISrkvBr2nJVW06S8IRB0lqDpLUGSWsNktYaJK01SFprkLTWh5dJwklbrkrCHdpykoS/TVuuSsLfJgknbTlpyxMGSWsNktYaJK01SFprkLTWIGmtQdJag6S10j/QvyoJV7XlDkn4JW15ShKuassvGSStNUhaa5C01iBprUHSWoOktQZJaw2S1vpwkyRs1JaTtrxFW06ScIe2fJOEOyThpC13aMs3SXhKW64aJK01SFprkLTWIGmtQdJag6S1BklrDZLW+vCgtvySJNwhCVe15Q5JuENb3qItT0nCN205ScJJW54wSFprkLTWIGmtQdJag6S1BklrDZLWGiSt9eFlkvCEtvySJJy05Q5tOUnCE5LwJm35JgknbTlJwklbrhokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktb6oFdoyxPacoe2nCThm7acJOEObTlJwkkSrkrCWwyS1hokrTVIWmuQtNYgaa1B0lqDpLU+6BWS8BZteYu2PKUtJ0m4qi0nSXjCIGmtQdJag6S1BklrDZLWGiStNUhaa5C01oeXacvfpi1PSMJJW+6QhJO2fJOEO7TlJAlPaMsvGSStNUhaa5C01iBprUHSWoOktQZJaw2S1vrwoCRslISr2vImbbmqLSdJOEnCWyThlwyS1hokrTVIWmuQtNYgaa1B0lqDpLUGSWulfyBppUHSWoOktQZJaw2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK01SFprkLTWIGmt/wF5W5z4BeJxegAAAABJRU5ErkJggg==", text: "https://example.com", width: 256, height: 256 } })} />
      </Widget>

      {/* 7. JWT Viewer */}
      <Widget id="w-jwt" label="7. JwtViewer — decode_jwt">
        <JwtViewer {...P({ toolName: "decode_jwt", status: complete, result: { json: { header: { alg: "RS256", typ: "JWT", kid: "abc123" }, payload: { sub: "user_42", name: "Alex Doe", email: "alex@example.com", iat: 1735689600, exp: 1735776000, iss: "ark.local", scope: "admin" }, signature: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", valid: true } } })} />
      </Widget>

      {/* 8. Chart Builder */}
      <Widget id="w-chart" label="8. ChartBuilder — generate_chart">
        <ChartBuilder {...P({ toolName: "generate_chart", status: complete, result: { chart_type: "bar", title: "Monthly Revenue", data: { labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], datasets: [{ name: "2025", values: [12, 19, 8, 15, 22, 28] }, { name: "2026", values: [18, 24, 14, 20, 30, 35] }] } } })} />
      </Widget>

      {/* 9. Code Playground */}
      <Widget id="w-code" label="9. CodePlayground — dev_run_code">
        <CodePlayground {...P({ toolName: "dev_run_code", status: complete, result: { code: "const fibonacci = (n) => {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n};\n\nfor (let i = 0; i < 10; i++) {\n  console.log(`fib(${i}) = ${fibonacci(i)}`);\n}", language: "javascript", output: "fib(0) = 0\nfib(1) = 1\nfib(2) = 1\nfib(3) = 2\nfib(4) = 3\nfib(5) = 5\nfib(6) = 8\nfib(7) = 13\nfib(8) = 21\nfib(9) = 34" } })} />
      </Widget>

      {/* 10. Markdown Editor */}
      <Widget id="w-markdown" label="10. MarkdownEditor — convert_md_html">
        <MarkdownEditor {...P({ toolName: "convert_md_html", status: complete, result: { markdown: "# Hello World\n\nThis is **bold** and *italic*.\n\n```js\nconsole.log('MOSS');\n```\n\n- Item one\n- Item two\n- Item three", html: "<h1>Hello World</h1><p>This is <strong>bold</strong> and <em>italic</em>.</p><pre><code class='language-js'>console.log('MOSS');</code></pre><ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>" } })} />
      </Widget>

      {/* 11. PDF Viewer */}
      <Widget id="w-pdf" label="11. PdfViewer — pdf_compress">
        <PdfViewer {...P({ toolName: "pdf_compress", status: complete, result: { output_url: "#", filename: "proposal-compressed.pdf", pages: 24, size_bytes: 1258291, original_size_bytes: 3874560, compression_ratio: 0.68 } })} />
      </Widget>

      {/* 12. Diff Viewer */}
      <Widget id="w-diff" label="12. DiffViewer — dev_diff">
        <DiffViewer {...P({ toolName: "dev_diff", status: complete, result: { diff: "--- a/config.ts\n+++ b/config.ts\n@@ -1,8 +1,10 @@\n export const config = {\n   port: 3000,\n-  host: 'localhost',\n-  debug: true,\n+  host: '0.0.0.0',\n+  debug: false,\n+  logLevel: 'info',\n   database: {\n     url: 'postgres://localhost/db',\n+    pool: 10,\n   },\n };", language: "typescript" } })} />
      </Widget>

      {/* 13. Table Result */}
      <Widget id="w-table" label="13. TableResult — convert_csv_json">
        <TableResult {...P({ toolName: "convert_csv_json", status: complete, result: { headers: ["Name", "Role", "Department", "Location", "Salary"], rows: [["Alice Chen", "Engineering Manager", "Engineering", "Shanghai", "$145,000"], ["Bob Tanaka", "Senior Engineer", "Engineering", "Tokyo", "$128,000"], ["Carlos Mendez", "Product Designer", "Design", "Mexico City", "$95,000"], ["Diana Park", "Data Scientist", "Analytics", "Seoul", "$118,000"], ["Ethan Williams", "Backend Engineer", "Engineering", "New York", "$132,000"], ["Fiona Okafor", "Product Manager", "Product", "Lagos", "$105,000"], ["George Liu", "DevOps Engineer", "Infrastructure", "Beijing", "$110,000"], ["Hannah Schmidt", "Frontend Engineer", "Engineering", "Berlin", "$122,000"]] } })} />
      </Widget>

      {/* 14. Whiteboard */}
      <Widget id="w-board" label="14. Whiteboard — generate_whiteboard">
        <Whiteboard {...P({ toolName: "generate_whiteboard", status: complete, result: {} })} />
      </Widget>

      {/* 15. Pomodoro Timer */}
      <Widget id="w-timer" label="15. PomodoroTimer — generate_pomodoro">
        <PomodoroTimer {...P({ toolName: "generate_pomodoro", status: complete, result: { minutes: 25, label: "Deep Work" } })} />
      </Widget>

      {/* 16. Chart — Pie */}
      <Widget id="w-pie" label="16. ChartBuilder (pie) — generate_chart">
        <ChartBuilder {...P({ toolName: "generate_chart", status: complete, result: { chart_type: "pie", title: "Market Share", data: { labels: ["Chrome", "Safari", "Firefox", "Edge", "Other"], datasets: [{ name: "Share", values: [65, 18, 7, 5, 5] }] } } })} />
      </Widget>

      {/* 17. Chart — Line */}
      <Widget id="w-line" label="17. ChartBuilder (line) — generate_chart">
        <ChartBuilder {...P({ toolName: "generate_chart", status: complete, result: { chart_type: "line", title: "User Growth", data: { labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"], datasets: [{ name: "Users", values: [120, 180, 250, 310, 420, 580, 710, 900] }] } } })} />
      </Widget>

      {/* 18. Music Player */}
      <Widget id="w-music" label="18. MusicPlayer — net_music_search">
        <MusicPlayer {...P({ toolName: "net_music_search", status: complete, result: { json: { songs: [{ id: 1, name: "晴天", artist: "周杰伦", album: "叶惠美", cover: "https://p1.music.126.net/DJaxrIXhLfxFRLEi1hN3Rg==/109951168369580046.jpg" }, { id: 2, name: "稻香", artist: "周杰伦", album: "魔杰座", cover: "https://p1.music.126.net/fBbSJfRCK2K9w4oy7MKjvA==/109951163020569490.jpg" }] } } })} />
      </Widget>

      {/* 19. Mermaid Viewer */}
      <Widget id="w-mermaid" label="19. MermaidViewer — generate_diagram">
        <MermaidViewer {...P({ toolName: "generate_diagram", status: complete, result: { diagram: "graph TD\n  A[User Request] --> B{Route}\n  B -->|Tool Call| C[Engine]\n  B -->|Chat| D[LLM]\n  C --> E[A2UI Widget]\n  D --> F[Text Response]" } })} />
      </Widget>

      {/* 20. Video Downloader */}
      <Widget id="w-downloader" label="20. VideoDownloader — media_video_info">
        <VideoDownloader {...P({ toolName: "media_video_info", status: complete, result: { title: "【4K】东京城市漫步 | 涩谷十字路口到新宿", thumbnail: "https://picsum.photos/640/360", duration: 1823, duration_str: "30:23", uploader: "CityWalks", platform: "bilibili", view_count: 2580000, formats: [{ format_id: "dash-1080p", ext: "mp4", resolution: "1920x1080", filesize_approx: 524288000 }, { format_id: "dash-720p", ext: "mp4", resolution: "1280x720", filesize_approx: 262144000 }, { format_id: "dash-480p", ext: "mp4", resolution: "854x480", filesize_approx: 131072000 }], subtitles_available: ["zh-Hans", "en", "ja"] } })} />
      </Widget>

      {/* 21. Subtitle Viewer */}
      <Widget id="w-subtitle" label="21. SubtitleViewer — media_extract_subtitle">
        <SubtitleViewer {...P({ toolName: "media_extract_subtitle", status: complete, result: { title: "Tokyo City Walk", language: "zh-Hans", total_entries: 5, entries: [{ index: 1, start: "00:00:01,000", end: "00:00:04,500", text: "欢迎来到东京城市漫步系列" }, { index: 2, start: "00:00:05,000", end: "00:00:08,200", text: "今天我们从涩谷十字路口出发" }, { index: 3, start: "00:00:09,000", end: "00:00:12,800", text: "这里是世界上最繁忙的十字路口之一" }, { index: 4, start: "00:00:13,500", end: "00:00:17,000", text: "每次绿灯亮起 约有3000人同时过马路" }, { index: 5, start: "00:00:18,000", end: "00:00:22,500", text: "让我们沿着道玄坂向新宿方向前进" }] } })} />
      </Widget>

      {/* ═══ NEW: 8 Super Productivity Tools ═══ */}
      <h2 className="text-lg font-bold text-white mt-12 mb-1">Super Productivity Tools (8 new)</h2>
      <p className="text-sm text-zinc-500 mb-6">Interactive mini-apps for productivity workflows</p>

      {/* 22. Kanban Board */}
      <Widget id="w-kanban" label="22. KanbanBoard — generate_kanban">
        <KanbanBoard {...P({ status: complete, result: { json: { title: "Sprint 42", columns: [{ name: "Todo", cards: ["Design landing page", "Write API docs", "Setup CI/CD"] }, { name: "In Progress", cards: ["Build auth flow", "Optimize queries"] }, { name: "Done", cards: ["Deploy staging", "Code review"] }] } } })} />
      </Widget>

      {/* 23. Mind Map */}
      <Widget id="w-mindmap" label="23. MindMap — generate_mindmap">
        <MindMap {...P({ status: complete, result: { json: { center: "AI Strategy", branches: [{ label: "Research", children: ["Papers", "Benchmarks", "Competitors"] }, { label: "Product", children: ["Features", "UX", "Pricing"] }, { label: "Engineering", children: ["Infra", "Models", "APIs"] }, { label: "Growth", children: ["Marketing", "Community"] }] } } })} />
      </Widget>

      {/* 24. Countdown Timer */}
      <Widget id="w-countdown" label="24. CountdownTimer — generate_countdown">
        <CountdownTimer {...P({ status: complete, result: { json: { target: new Date(Date.now() + 86400000 * 7).toISOString(), label: "Product Launch" } } })} />
      </Widget>

      {/* 25. Habit Tracker */}
      <Widget id="w-habits" label="25. HabitTracker — generate_habits">
        <HabitTracker {...P({ status: complete, result: { json: { habits: [{ name: "Exercise", color: "#22c55e" }, { name: "Read", color: "#3b82f6" }, { name: "Meditate", color: "#f59e0b" }, { name: "Code", color: "#ec4899" }] } } })} />
      </Widget>

      {/* 26. Flashcard Deck */}
      <Widget id="w-flashcards" label="26. FlashcardDeck — generate_flashcards">
        <FlashcardDeck {...P({ status: complete, result: { json: { title: "JavaScript Basics", cards: [{ front: "What is a closure?", back: "A function that captures variables from its outer scope" }, { front: "What is hoisting?", back: "Declarations are moved to the top of their scope" }, { front: "What is the event loop?", back: "A mechanism for handling async operations" }, { front: "What is 'this'?", back: "A reference to the object executing the current function" }] } } })} />
      </Widget>

      {/* 27. World Clock */}
      <Widget id="w-worldclock" label="27. WorldClock — generate_worldclock">
        <WorldClock {...P({ status: complete, result: { json: { cities: [{ name: "New York", timezone: "America/New_York" }, { name: "London", timezone: "Europe/London" }, { name: "Beijing", timezone: "Asia/Shanghai" }, { name: "Tokyo", timezone: "Asia/Tokyo" }] } } })} />
      </Widget>

      {/* 28. Excalidraw Board */}
      <Widget id="w-excalidraw" label="28. ExcalidrawBoard — generate_excalidraw">
        <ExcalidrawBoard {...P({ status: complete, result: { json: { topic: "Architecture Diagram" } } })} />
      </Widget>

      {/* 29. Spreadsheet Grid */}
      <Widget id="w-spreadsheet" label="29. SpreadsheetGrid — generate_spreadsheet">
        <SpreadsheetGrid {...P({ status: complete, result: { json: { title: "Team Roster", headers: ["Name", "Role", "Email", "Status"], rows: [["Alice Chen", "Frontend", "alice@co.dev", "Active"], ["Bob Wu", "Backend", "bob@co.dev", "Active"], ["Carol Li", "Design", "carol@co.dev", "On Leave"], ["Dave Kim", "DevOps", "dave@co.dev", "Active"]] } } })} />
      </Widget>

      {/* ═══ NEW: 10 Open-Source Tool Integrations ═══ */}
      <h2 className="text-lg font-bold text-white mt-12 mb-1">Open-Source Integrations (10 new)</h2>
      <p className="text-sm text-zinc-500 mb-6">tldraw, React Flow, BlockNote, Novel, Sandpack, VERT, Univer, Tremor, Sigma.js, Mantine</p>

      {/* 30. tldraw Canvas */}
      <Widget id="w-tldraw" label="30. TldrawCanvas — tldraw_canvas">
        <TldrawCanvas {...P({ toolName: "tldraw_canvas", status: complete, result: { topic: "Architecture Brainstorm" } })} />
      </Widget>

      {/* 31. React Flow Editor */}
      <Widget id="w-flow" label="31. FlowEditor — flow_editor">
        <FlowEditor {...P({ toolName: "flow_editor", status: complete, result: { title: "AI Pipeline", nodes: [{ id: "1", type: "input", data: { label: "User Input" }, position: { x: 50, y: 50 } }, { id: "2", type: "process", data: { label: "LLM Router" }, position: { x: 250, y: 50 } }, { id: "3", type: "process", data: { label: "Tool Engine" }, position: { x: 250, y: 180 } }, { id: "4", type: "output", data: { label: "A2UI Widget" }, position: { x: 450, y: 50 } }, { id: "5", type: "output", data: { label: "Text Response" }, position: { x: 450, y: 180 } }], edges: [{ id: "e1-2", source: "1", target: "2" }, { id: "e2-3", source: "2", target: "3" }, { id: "e2-4", source: "2", target: "4" }, { id: "e3-5", source: "3", target: "5" }] } })} />
      </Widget>

      {/* 32. BlockNote Editor */}
      <Widget id="w-blocknote" label="32. BlockEditor — block_editor">
        <BlockEditor {...P({ toolName: "block_editor", status: complete, result: { title: "Meeting Notes", markdown: "# Q1 Review\n\n## Key Metrics\n- Revenue: **$2.4M** (+18% QoQ)\n- Users: **45K** DAU\n- Churn: 3.2%\n\n## Action Items\n1. Launch enterprise tier by March\n2. Hire 2 senior engineers\n3. Optimize onboarding funnel\n\n> Focus on retention over acquisition this quarter." } })} />
      </Widget>

      {/* 33. Novel AI Editor */}
      <Widget id="w-novel" label="33. NovelEditor — novel_editor">
        <NovelEditor {...P({ toolName: "novel_editor", status: complete, result: { title: "Blog Draft", content: "The future of AI assistants lies not in replacing human creativity, but in amplifying it. When we designed MOSS, we started with a simple question: what if your entire company could think together?" } })} />
      </Widget>

      {/* 34. Sandpack Sandbox */}
      <Widget id="w-sandpack" label="34. SandpackSandbox — sandpack_sandbox">
        <SandpackSandbox {...P({ toolName: "sandpack_sandbox", status: complete, result: { template: "react", files: { "/App.js": "import { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>\n      <h1>Counter: {count}</h1>\n      <button onClick={() => setCount(c => c + 1)}\n        style={{ padding: '8px 16px', fontSize: 16, cursor: 'pointer' }}>\n        Increment\n      </button>\n    </div>\n  );\n}" } } })} />
      </Widget>

      {/* 35. File Converter */}
      <Widget id="w-converter" label="35. FileConverter — file_converter">
        <FileConverter {...P({ toolName: "file_converter", status: complete, result: { source_format: "json", target_format: "csv" } })} />
      </Widget>

      {/* 36. Univer Sheet */}
      <Widget id="w-univer" label="36. UniverSheet — univer_sheet">
        <UniverSheet {...P({ toolName: "univer_sheet", status: complete, result: { title: "Sales Report Q1", headers: ["Product", "Q1 Revenue", "Q1 Units", "Growth"], rows: [["Widget Pro", "$450,000", "12,500", "+18%"], ["Widget Lite", "$280,000", "35,000", "+24%"], ["Enterprise Suite", "$1,200,000", "850", "+8%"], ["API Access", "$180,000", "2,400", "+42%"], ["Support Plan", "$95,000", "1,200", "+15%"]] } })} />
      </Widget>

      {/* 37. Tremor Dashboard */}
      <Widget id="w-tremor" label="37. TremorDashboard — tremor_dashboard">
        <TremorDashboard {...P({ toolName: "tremor_dashboard", status: complete, result: { title: "MOSS Analytics", kpis: [{ label: "Total Users", value: "45,231", change: 12.5, changeLabel: "vs last month" }, { label: "API Calls", value: "2.8M", change: -3.2, changeLabel: "vs last week" }, { label: "Uptime", value: "99.97%", change: 0.02, progress: 99.97 }, { label: "Avg Latency", value: "142ms", change: -8.5 }], charts: [{ type: "area", title: "Daily Active Users", categories: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], series: [{ name: "Users", data: [4200, 4800, 5100, 4900, 5500, 3200, 2800] }] }], tables: [{ title: "Top Endpoints", headers: ["Endpoint", "Calls", "P95", "Errors"], rows: [["/api/chat", "1.2M", "89ms", "0.01%"], ["/api/tools", "890K", "145ms", "0.03%"], ["/api/auth", "450K", "42ms", "0.00%"]] }] } })} />
      </Widget>

      {/* 38. Graph Viewer */}
      <Widget id="w-graph" label="38. GraphViewer — graph_viewer">
        <GraphViewer {...P({ toolName: "graph_viewer", status: complete, result: { nodes: [{ id: "moss", label: "MOSS", group: "core" }, { id: "gateway", label: "Gateway", group: "core" }, { id: "feishu", label: "Feishu", group: "channel" }, { id: "telegram", label: "Telegram", group: "channel" }, { id: "claude", label: "Claude API", group: "ai" }, { id: "proxy", label: "Proxy", group: "core" }, { id: "memory", label: "Memory", group: "data" }, { id: "skills", label: "Skills", group: "data" }, { id: "agents", label: "Agents", group: "ai" }, { id: "tools", label: "Tools", group: "ai" }], edges: [{ source: "moss", target: "gateway" }, { source: "gateway", target: "feishu" }, { source: "gateway", target: "telegram" }, { source: "gateway", target: "proxy" }, { source: "proxy", target: "claude" }, { source: "moss", target: "memory" }, { source: "moss", target: "skills" }, { source: "claude", target: "agents" }, { source: "claude", target: "tools" }, { source: "agents", target: "tools" }] } })} />
      </Widget>

      {/* 39. Mantine Toolkit */}
      <Widget id="w-mantine" label="39. MantineToolkit — mantine_toolkit">
        <MantineToolkit {...P({ toolName: "mantine_toolkit", status: complete, result: { type: "color" } })} />
      </Widget>

      <div className="h-16" />
    </div>
  );
}
