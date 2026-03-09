// @input: Tool result with { headers, rows } | { csv } | { data } | { text }
// @output: Sortable data table with CSV export and copy
// @position: A2UI widget — tabular data mini-app

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TableIcon, CopyIcon, CheckIcon, DownloadIcon, ChevronUpIcon, ChevronDownIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useCopyFeedback } from "./hooks";
import { memoWidget, triggerDownload, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

const PREVIEW_LIMIT = 50;

type SortDir = "asc" | "desc" | null;
type TableData = { headers: string[]; rows: string[][] };

const parseData = (r: Record<string, unknown>): TableData | null => {
  if (Array.isArray(r.rows) && Array.isArray(r.headers))
    return { headers: r.headers as string[], rows: r.rows as string[][] };

  const csv = typeof r.csv === "string" ? r.csv : typeof r.text === "string" ? r.text : null;
  if (csv) {
    const lines = csv.trim().split("\n").filter(Boolean);
    if (lines.length < 2) return null;
    const parse = (line: string) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return { headers: parse(lines[0]), rows: lines.slice(1).map(parse) };
  }

  if (Array.isArray(r.data) && r.data.length > 0 && typeof r.data[0] === "object") {
    const headers = Object.keys(r.data[0] as object);
    const rows = (r.data as Record<string, unknown>[]).map((obj) => headers.map((h) => String(obj[h] ?? "")));
    return { headers, rows };
  }

  return null;
};

const buildCsv = ({ headers, rows }: TableData) =>
  [headers, ...rows].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");

const TableResultImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<TableData | null>(null);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [showAll, setShowAll] = useState(false);
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    if (status.type !== "complete") return;
    setData(parseData(unwrapResult(result)));
  }, [result, status.type]);

  const sorted = useMemo(() => {
    if (!data || sortCol === null || sortDir === null) return data?.rows ?? [];
    return [...data.rows].sort((a, b) => {
      const cmp = (a[sortCol] ?? "").localeCompare(b[sortCol] ?? "", undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortCol, sortDir]);

  const visible = showAll ? sorted : sorted.slice(0, PREVIEW_LIMIT);

  const toggleSort = useCallback((i: number) => {
    setSortCol(i);
    setSortDir((d) => i !== sortCol ? "asc" : d === "asc" ? "desc" : d === "desc" ? null : "asc");
  }, [sortCol]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const blob = new Blob([buildCsv(data)], { type: "text/csv" });
    triggerDownload(URL.createObjectURL(blob), "table.csv");
  }, [data]);

  const copyTable = useCallback(() => {
    if (!data) return;
    copy([data.headers.join("\t"), ...sorted.map((r) => r.join("\t"))].join("\n"));
  }, [data, sorted, copy]);

  const skeleton = (
    <>
      <div className="flex items-center gap-2">
        <TableIcon className="size-3.5 animate-pulse text-blue-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-2 space-y-1">
        {[95, 75, 85, 60, 70].map((w, i) => <div key={i} className="h-2 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%` }} />)}
      </div>
    </>
  );

  if (!data || data.rows.length === 0) return null;

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <TableIcon className="size-3 text-blue-400" />
        <span className="text-[11px] font-medium text-zinc-300">Table</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{data.rows.length} rows</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={exportCsv} aria-label="Export CSV" className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            <DownloadIcon className="size-3" />
          </button>
          <button onClick={copyTable} aria-label="Copy table" className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-zinc-800">
            <tr>
              {data.headers.map((h, i) => (
                <th key={i} onClick={() => toggleSort(i)} className="px-2 py-1 text-left text-[11px] uppercase text-zinc-400 font-medium cursor-pointer select-none hover:text-zinc-200 whitespace-nowrap">
                  <span className="inline-flex items-center gap-0.5">
                    {h}
                    {sortCol === i && sortDir === "asc" && <ChevronUpIcon className="size-2.5" />}
                    {sortCol === i && sortDir === "desc" && <ChevronDownIcon className="size-2.5" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 1 ? "bg-white/[0.02]" : ""}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-2 py-1 font-mono text-[11px] text-zinc-300 whitespace-nowrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && sorted.length > PREVIEW_LIMIT && (
        <div className="border-t border-white/5 px-3 py-1.5 text-center">
          <button onClick={() => setShowAll(true)} className="text-[11px] text-blue-400 hover:text-blue-300 transition">
            Show all {sorted.length} rows
          </button>
        </div>
      )}
    </DarkShell>
  );
};

export const TableResult = memoWidget(TableResultImpl);
