// @input: Tool result with { title?, headers, rows }
// @output: Interactive editable spreadsheet grid
// @position: A2UI widget — spreadsheet mini-app

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Grid3X3Icon, PlusIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type CellPos = { row: number; col: number };
type GridData = { title: string; headers: string[]; rows: string[][] };

const skeleton = (
  <div className="p-3 space-y-1.5">
    <div className="flex items-center gap-2">
      <Grid3X3Icon className="size-3 animate-pulse text-teal-400" />
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
    </div>
    <div className="mt-2 space-y-1">
      {[100, 85, 90, 75].map((w, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  </div>
);

function CellInput({ value, onCommit, onCancel, onTabNext }: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  onTabNext: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      defaultValue={value}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit((e.target as HTMLInputElement).value); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        if (e.key === "Tab") { e.preventDefault(); onCommit((e.target as HTMLInputElement).value); onTabNext(); }
      }}
      className="w-full min-w-0 bg-zinc-800 px-1 py-0 text-[11px] text-white outline-none ring-1 ring-teal-400/60 rounded-sm"
    />
  );
}

function DataCell({ value, isSelected, isEditing, onSelect, onEdit, onCommit, onCancel, onTabNext }: {
  value: string; isSelected: boolean; isEditing: boolean;
  onSelect: () => void; onEdit: () => void;
  onCommit: (v: string) => void; onCancel: () => void; onTabNext: () => void;
}) {
  return (
    <td
      onClick={onSelect}
      onDoubleClick={onEdit}
      onKeyDown={(e) => { if (e.key === "Enter" && isSelected && !isEditing) onEdit(); }}
      tabIndex={0}
      className={cn(
        "border border-white/10 px-2 py-1 text-[11px] text-zinc-100 transition-colors duration-150 cursor-default min-w-[80px]",
        isSelected && !isEditing && "border-teal-500/50 ring-1 ring-inset ring-teal-500/30 bg-teal-500/5",
        !isSelected && "hover:bg-zinc-800/50"
      )}
    >
      {isEditing
        ? <CellInput value={value} onCommit={onCommit} onCancel={onCancel} onTabNext={onTabNext} />
        : <span className="block truncate">{value}</span>
      }
    </td>
  );
}

const SpreadsheetGridImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<GridData | null>(null);
  const [selected, setSelected] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<CellPos | null>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    if (!Array.isArray(json.headers) || !Array.isArray(json.rows)) return;
    setData({
      title: typeof json.title === "string" ? json.title : "Spreadsheet",
      headers: [...(json.headers as string[])],
      rows: (json.rows as string[][]).map((r) => [...r]),
    });
  }, [result, status.type]);

  const commitCell = useCallback((row: number, col: number, value: string) => {
    setData((d) => {
      if (!d) return d;
      const rows = d.rows.map((r, ri) => ri === row ? r.map((c, ci) => ci === col ? value : c) : r);
      return { ...d, rows };
    });
    setEditing(null);
    setSelected({ row, col });
  }, []);

  const addRow = useCallback(() => {
    setData((d) => {
      if (!d) return d;
      return { ...d, rows: [...d.rows, d.headers.map(() => "")] };
    });
  }, []);

  const deleteRow = useCallback((ri: number) => {
    setData((d) => {
      if (!d) return d;
      return { ...d, rows: d.rows.filter((_, i) => i !== ri) };
    });
    setSelected(null);
    setEditing(null);
  }, []);

  if (!data) return null;

  const totalCells = data.headers.length * data.rows.length;

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <Grid3X3Icon className="size-3 text-teal-400" />
        <span className="text-[11px] font-medium text-zinc-300">{data.title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/10 text-teal-400">{totalCells} cells</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-zinc-800/80 backdrop-blur-sm">
            <tr>
              <th className="w-8 border border-white/10 bg-zinc-800/50 px-1 py-1 text-center text-[9px] text-zinc-500">#</th>
              {data.headers.map((h, i) => (
                <th key={i} className="border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th className="w-6 border border-white/10 bg-zinc-800/50" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} className={cn("group hover:bg-zinc-800/30", ri % 2 === 1 && "bg-white/[0.015]")}>
                <td className="border border-white/10 bg-zinc-800/50 px-1 py-1 text-center text-[9px] text-zinc-500 select-none">
                  {ri + 1}
                </td>
                {row.map((cell, ci) => (
                  <DataCell
                    key={ci}
                    value={cell}
                    isSelected={selected?.row === ri && selected?.col === ci}
                    isEditing={editing?.row === ri && editing?.col === ci}
                    onSelect={() => { setSelected({ row: ri, col: ci }); setEditing(null); }}
                    onEdit={() => setEditing({ row: ri, col: ci })}
                    onCommit={(v) => commitCell(ri, ci, v)}
                    onCancel={() => { setEditing(null); setSelected({ row: ri, col: ci }); }}
                    onTabNext={() => setEditing(ci + 1 < row.length ? { row: ri, col: ci + 1 } : ri + 1 < data.rows.length ? { row: ri + 1, col: 0 } : null)}
                  />
                ))}
                <td className="border border-white/10 bg-zinc-800/50 px-1 text-center">
                  <button
                    onClick={() => deleteRow(ri)}
                    aria-label={`Delete row ${ri + 1}`}
                    className="hidden group-hover:flex min-h-[20px] min-w-[20px] items-center justify-center rounded text-[10px] text-zinc-600 hover:text-rose-400 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 mx-auto"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add row */}
      <div className="border-t border-white/5">
        <button
          onClick={addRow}
          aria-label="Add row"
          className="flex min-h-[44px] w-full items-center justify-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          <PlusIcon className="size-3" />
          <span>Add row</span>
        </button>
      </div>
    </DarkShell>
  );
};

export const SpreadsheetGrid = memoWidget(SpreadsheetGridImpl);
