// @input: Tool result with { title?, headers, rows } or 2D array data
// @output: Univer Excel-like interactive spreadsheet
// @position: A2UI widget — Excel-grade online sheet mini-app

"use client";

import { useEffect, useRef, useState } from "react";
import { TableIcon, AlertCircleIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

// --- Types ---

type SheetData = {
  title: string;
  headers: string[];
  rows: string[][];
};

// --- Skeleton ---

const skeleton = (
  <div className="p-3 space-y-2">
    <div className="flex items-center gap-2">
      <TableIcon className="size-3 animate-pulse text-emerald-400" />
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
    </div>
    <div className="space-y-1 mt-2">
      <div className="h-6 w-full animate-pulse rounded bg-zinc-700/60" />
      {[90, 85, 80, 75].map((w, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  </div>
);

// --- Parse incoming result into SheetData ---

function parseSheet(result: unknown): SheetData | null {
  const json = unwrapResult(result);
  if (!json || typeof json !== "object") return null;

  // Format: { headers: string[], rows: string[][] }
  if (Array.isArray(json.headers) && Array.isArray(json.rows)) {
    return {
      title: typeof json.title === "string" ? json.title : "Sheet",
      headers: json.headers as string[],
      rows: (json.rows as unknown[][]).map((r) =>
        (Array.isArray(r) ? r : []).map(String)
      ),
    };
  }

  // Format: raw 2D array
  if (Array.isArray(json.data) && Array.isArray(json.data[0])) {
    const [headerRow, ...dataRows] = json.data as string[][];
    return {
      title: typeof json.title === "string" ? json.title : "Sheet",
      headers: headerRow.map(String),
      rows: dataRows.map((r) => r.map(String)),
    };
  }

  return null;
}

// --- Convert SheetData to Univer IWorkbookData ---

function toWorkbookData(sheet: SheetData) {
  const cellData: Record<number, Record<number, { v: string; s?: string }>> = {};

  // Header row (row 0) — bold style
  sheet.headers.forEach((h, ci) => {
    cellData[0] = cellData[0] ?? {};
    cellData[0][ci] = { v: h, s: "header" };
  });

  // Data rows
  sheet.rows.forEach((row, ri) => {
    const rowIndex = ri + 1;
    cellData[rowIndex] = {};
    row.forEach((cell, ci) => {
      cellData[rowIndex][ci] = { v: cell };
    });
  });

  const colCount = Math.max(sheet.headers.length, 10);
  const rowCount = Math.max(sheet.rows.length + 1, 20);

  return {
    id: "sheet-1",
    locale: "enUS",
    name: sheet.title,
    sheetOrder: ["main"],
    styles: {
      header: {
        bl: 1,
        bg: { rgb: "#1e1e1e" },
        cl: { rgb: "#a1a1aa" },
        fs: 11,
      },
    },
    sheets: {
      main: {
        id: "main",
        name: "Sheet1",
        rowCount,
        columnCount: colCount,
        cellData,
        defaultRowHeight: 22,
        defaultColumnWidth: 100,
      },
    },
    resources: [],
  };
}

// --- Univer Container ---

type UniverInstance = {
  createUniverSheet: (data: unknown) => void;
  dispose: () => void;
};

async function mountUniver(container: HTMLElement, data: SheetData): Promise<UniverInstance> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [presetsMod, sheetsMod] = await Promise.all([
    import("@univerjs/presets") as Promise<any>,
    import("@univerjs/presets/preset-sheets-core") as Promise<any>,
  ]);

  const { createUniver, LocaleType } = presetsMod;
  const { UniverSheetsCorePreset } = sheetsMod;

  const { univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    presets: [
      UniverSheetsCorePreset({ container, workerURL: undefined }),
    ],
  });

  const workbookData = toWorkbookData(data);
  univerAPI.createUniverSheet(workbookData);

  return {
    createUniverSheet: (d: unknown) => univerAPI.createUniverSheet(d),
    dispose: () => univerAPI.dispose?.(),
  };
}

// --- Main Widget ---

const UniverSheetImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<UniverInstance | null>(null);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (status.type !== "complete") return;
    const parsed = parseSheet(result);
    setSheet(parsed);
  }, [result, status.type]);

  useEffect(() => {
    if (!sheet || !containerRef.current || mounted) return;

    let disposed = false;
    setMounted(true);

    mountUniver(containerRef.current, sheet)
      .then((instance) => {
        if (disposed) { instance.dispose(); return; }
        instanceRef.current = instance;
      })
      .catch((err) => {
        if (!disposed) setError(String(err?.message ?? "Failed to load Univer"));
      });

    return () => {
      disposed = true;
      instanceRef.current?.dispose();
      instanceRef.current = null;
      setMounted(false);
    };
  }, [sheet, mounted]);

  if (!sheet) return null;

  const pill = {
    icon: TableIcon,
    label: "Sheet",
    accent: "text-emerald-400",
    bgAccent: "bg-emerald-500/15",
  };

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton} pill={pill} result={result} title={sheet.title} icon={<TableIcon className="size-4" />}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <TableIcon className="size-3 text-emerald-400" />
        <span className="text-[11px] font-medium text-zinc-300">{sheet.title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
          {sheet.headers.length}×{sheet.rows.length}
        </span>
      </div>

      {error ? (
        <div className="flex items-center gap-2 p-3 text-[11px] text-rose-400">
          <AlertCircleIcon className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: "320px", position: "relative", overflow: "hidden" }}
        />
      )}
    </DarkShell>
  );
};

export const UniverSheet = memoWidget(UniverSheetImpl);
