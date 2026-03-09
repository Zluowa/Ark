// @input: AI-provided params for productivity widgets
// @output: Pass-through results for frontend rendering
// @position: Productivity tool handlers — minimal backend for interactive widgets

import type { ToolManifest, ToolHandler, ToolRegistryEntry } from "@/lib/engine/types";
import { FAST_TIMEOUT_MS } from "@/lib/engine/types";

const ok = (data: Record<string, unknown>, start: number): ReturnType<ToolHandler> =>
  Promise.resolve({ status: "success", output: data, duration_ms: Date.now() - start });

const parseJson = (v: unknown, fallback: unknown): unknown => {
  if (typeof v === "string") try { return JSON.parse(v); } catch { /* ignore */ }
  if (Array.isArray(v) || (typeof v === "object" && v !== null)) return v;
  return fallback;
};

/* ── 1. Kanban Board ── */

const kanbanManifest: ToolManifest = {
  id: "generate.kanban", name: "Kanban Board",
  description: "Create an interactive kanban board with columns and task cards",
  category: "generate", tags: ["kanban", "todo", "board", "tasks"],
  params: [
    { name: "title", type: "string", required: false, default: "My Board", description: "Board title" },
    { name: "columns", type: "string", required: true, description: 'JSON array: [{"name":"Todo","cards":["Task 1"]}]' },
  ],
  output_type: "json",
  keywords: ["kanban", "board", "todo", "task", "看板", "任务板", "待办"],
  patterns: ["kanban", "task.*board", "todo.*board", "看板"],
};

const kanbanHandler: ToolHandler = async (params) => {
  const start = Date.now();
  const columns = parseJson(params.columns, [
    { name: "Todo", cards: [] }, { name: "In Progress", cards: [] }, { name: "Done", cards: [] },
  ]);
  return ok({ title: params.title ?? "My Board", columns }, start);
};

export const generateKanban: ToolRegistryEntry = {
  manifest: kanbanManifest, handler: kanbanHandler, timeout: FAST_TIMEOUT_MS,
};

/* ── 2. Mind Map ── */

const mindmapManifest: ToolManifest = {
  id: "generate.mindmap", name: "Mind Map",
  description: "Create a visual mind map with a center topic and branches",
  category: "generate", tags: ["mindmap", "brainstorm", "diagram"],
  params: [
    { name: "center", type: "string", required: true, description: "Central topic" },
    { name: "branches", type: "string", required: true, description: 'JSON: [{"label":"Branch","children":["Leaf"]}]' },
  ],
  output_type: "json",
  keywords: ["mindmap", "mind map", "brainstorm", "思维导图", "脑图"],
  patterns: ["mind.*map", "brainstorm", "思维导图"],
};

const mindmapHandler: ToolHandler = async (params) => {
  const start = Date.now();
  return ok({ center: String(params.center ?? "Topic"), branches: parseJson(params.branches, []) }, start);
};

export const generateMindmap: ToolRegistryEntry = {
  manifest: mindmapManifest, handler: mindmapHandler, timeout: FAST_TIMEOUT_MS,
};

/* ── 3. Countdown Timer ── */

const countdownManifest: ToolManifest = {
  id: "generate.countdown", name: "Countdown Timer",
  description: "Create a countdown timer to a target date/time",
  category: "generate", tags: ["countdown", "timer", "event"],
  params: [
    { name: "target", type: "string", required: true, description: "Target datetime (ISO 8601)" },
    { name: "label", type: "string", required: false, default: "Countdown", description: "Display label" },
  ],
  output_type: "json",
  keywords: ["countdown", "timer", "event", "deadline", "倒计时"],
  patterns: ["count.*down", "timer.*to", "倒计时"],
};

const countdownHandler: ToolHandler = async (params) => {
  const start = Date.now();
  return ok({ target: String(params.target ?? ""), label: String(params.label ?? "Countdown") }, start);
};

export const generateCountdown: ToolRegistryEntry = {
  manifest: countdownManifest, handler: countdownHandler, timeout: FAST_TIMEOUT_MS,
};

/* ── 4. Habit Tracker ── */

const habitsManifest: ToolManifest = {
  id: "generate.habits", name: "Habit Tracker",
  description: "Create a habit tracker with daily check-ins and streak visualization",
  category: "generate", tags: ["habits", "tracker", "streak"],
  params: [
    { name: "habits", type: "string", required: true, description: 'JSON: [{"name":"Exercise","color":"#22c55e"}]' },
  ],
  output_type: "json",
  keywords: ["habit", "tracker", "streak", "daily", "习惯", "打卡"],
  patterns: ["habit.*track", "daily.*track", "习惯", "打卡"],
};

const habitsHandler: ToolHandler = async (params) => {
  const start = Date.now();
  return ok({ habits: parseJson(params.habits, [{ name: "Habit", color: "#22c55e" }]) }, start);
};

export const generateHabits: ToolRegistryEntry = {
  manifest: habitsManifest, handler: habitsHandler, timeout: FAST_TIMEOUT_MS,
};

/* ── 5. Flashcard Deck ── */

const flashcardsManifest: ToolManifest = {
  id: "generate.flashcards", name: "Flashcard Deck",
  description: "Create an interactive flashcard deck for studying with flip animation",
  category: "generate", tags: ["flashcards", "study", "quiz"],
  params: [
    { name: "title", type: "string", required: false, default: "Flashcards", description: "Deck title" },
    { name: "cards", type: "string", required: true, description: 'JSON: [{"front":"Question","back":"Answer"}]' },
  ],
  output_type: "json",
  keywords: ["flashcard", "study", "learn", "quiz", "卡片", "学习", "记忆卡"],
  patterns: ["flash.*card", "study.*card", "记忆卡"],
};

const flashcardsHandler: ToolHandler = async (params) => {
  const start = Date.now();
  return ok({
    title: params.title ?? "Flashcards",
    cards: parseJson(params.cards, [{ front: "?", back: "!" }]),
  }, start);
};

export const generateFlashcards: ToolRegistryEntry = {
  manifest: flashcardsManifest, handler: flashcardsHandler, timeout: FAST_TIMEOUT_MS,
};

/* ── 6. World Clock ── */

const worldclockManifest: ToolManifest = {
  id: "generate.worldclock", name: "World Clock",
  description: "Display current time across multiple timezones with analog clocks",
  category: "generate", tags: ["clock", "timezone", "world"],
  params: [
    { name: "cities", type: "string", required: true, description: 'JSON: [{"name":"Tokyo","timezone":"Asia/Tokyo"}]' },
  ],
  output_type: "json",
  keywords: ["world clock", "timezone", "时区", "世界时钟"],
  patterns: ["world.*clock", "time.*zone", "时区"],
};

const worldclockHandler: ToolHandler = async (params) => {
  const start = Date.now();
  return ok({
    cities: parseJson(params.cities, [
      { name: "New York", timezone: "America/New_York" },
      { name: "London", timezone: "Europe/London" },
      { name: "Tokyo", timezone: "Asia/Tokyo" },
    ]),
  }, start);
};

export const generateWorldclock: ToolRegistryEntry = {
  manifest: worldclockManifest, handler: worldclockHandler, timeout: FAST_TIMEOUT_MS,
};

/* ── 7. Excalidraw-style Board ── */

const excalidrawManifest: ToolManifest = {
  id: "generate.excalidraw", name: "Excalidraw Board",
  description: "Open an interactive vector drawing whiteboard (Excalidraw-style)",
  category: "generate", tags: ["excalidraw", "draw", "whiteboard", "sketch"],
  params: [
    { name: "topic", type: "string", required: false, description: "Optional topic for the board" },
  ],
  output_type: "json",
  keywords: ["excalidraw", "draw", "whiteboard", "sketch", "画板", "白板"],
  patterns: ["excalidraw", "draw.*board", "white.*board", "画板", "白板"],
};

const excalidrawHandler: ToolHandler = async (params) => {
  const start = Date.now();
  return ok({ topic: String(params.topic ?? "") }, start);
};

export const generateExcalidraw: ToolRegistryEntry = {
  manifest: excalidrawManifest, handler: excalidrawHandler, timeout: FAST_TIMEOUT_MS,
};

/* ── 8. Spreadsheet ── */

const spreadsheetManifest: ToolManifest = {
  id: "generate.spreadsheet", name: "Spreadsheet",
  description: "Create an interactive spreadsheet with editable cells",
  category: "generate", tags: ["spreadsheet", "table", "excel", "data"],
  params: [
    { name: "title", type: "string", required: false, default: "Sheet", description: "Sheet title" },
    { name: "headers", type: "string", required: true, description: 'JSON: ["Name","Age","City"]' },
    { name: "rows", type: "string", required: true, description: 'JSON 2D: [["Alice","30","NYC"]]' },
  ],
  output_type: "json",
  keywords: ["spreadsheet", "excel", "table", "data", "表格", "电子表格"],
  patterns: ["spread.*sheet", "excel", "电子表格"],
};

const spreadsheetHandler: ToolHandler = async (params) => {
  const start = Date.now();
  return ok({
    title: params.title ?? "Sheet",
    headers: parseJson(params.headers, ["A", "B", "C"]),
    rows: parseJson(params.rows, [["", "", ""]]),
  }, start);
};

export const generateSpreadsheet: ToolRegistryEntry = {
  manifest: spreadsheetManifest, handler: spreadsheetHandler, timeout: FAST_TIMEOUT_MS,
};
