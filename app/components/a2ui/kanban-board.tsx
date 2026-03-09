// @input: Tool result with { title, columns: Array<{ name, cards }> }
// @output: Interactive kanban board with add/remove/done toggle per card
// @position: A2UI widget — kanban board mini-app

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { LayoutDashboardIcon, PlusIcon, XIcon, GripVerticalIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

// --- Types ---

type Card = { id: number; text: string; done: boolean };
type Column = { name: string; cards: Card[] };

// --- Constants (data-driven, no if/else) ---

const COLUMN_ACCENTS = ["border-indigo-500/50", "border-violet-500/50", "border-emerald-500/50", "border-amber-500/50", "border-rose-500/50"] as const;
const BADGE_ACCENTS = ["bg-indigo-500/25 text-indigo-300", "bg-violet-500/25 text-violet-300", "bg-emerald-500/25 text-emerald-300", "bg-amber-500/25 text-amber-300", "bg-rose-500/25 text-rose-300"] as const;

let nextId = 1;
const makeId = () => nextId++;

const parseColumns = (raw: unknown[]): Column[] =>
  (raw as Array<{ name?: unknown; cards?: unknown[] }>).map((col) => ({
    name: String(col.name ?? ""),
    cards: (col.cards ?? []).map((c) => ({ id: makeId(), text: String(c), done: false })),
  }));

// --- Sub-components ---

type CardItemProps = {
  card: Card;
  onToggle: () => void;
  onRemove: () => void;
};

function CardItem({ card, onToggle, onRemove }: CardItemProps) {
  return (
    <div className="group flex items-start gap-1 rounded-md bg-zinc-800 px-2 py-1.5 hover:bg-zinc-700 transition-colors duration-150">
      <GripVerticalIcon className="mt-0.5 size-2.5 shrink-0 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
      <button
        onClick={onToggle}
        aria-label={card.done ? "Mark undone" : "Mark done"}
        className={cn(
          "flex-1 text-left text-[11px] leading-snug transition-colors focus-visible:outline-none",
          card.done ? "line-through text-zinc-500" : "text-zinc-200"
        )}
      >
        {card.text}
      </button>
      <button
        onClick={onRemove}
        aria-label="Remove card"
        className="min-h-[20px] min-w-[20px] shrink-0 flex items-center justify-center rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      >
        <XIcon className="size-2.5" />
      </button>
    </div>
  );
}

function AddCardInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed) onAdd(trimmed);
    setText(""); setOpen(false);
  }, [text, onAdd]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!open) return (
    <button onClick={() => setOpen(true)} aria-label="Add card"
      className="flex min-h-[44px] w-full items-center gap-1 rounded-md px-2 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
      <PlusIcon className="size-3" /><span>Add card</span>
    </button>
  );

  return (
    <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setText(""); setOpen(false); } }}
      onBlur={commit} placeholder="Card text…"
      className="w-full rounded-md bg-zinc-700 px-2 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-white/20"
    />
  );
}

// --- Main widget ---

const skeleton = (
  <div className="flex gap-2 p-3">
    {[140, 120, 150].map((w, i) => (
      <div key={i} className="rounded-lg bg-zinc-800 animate-pulse" style={{ width: w, height: 80, animationDelay: `${i * 100}ms` }} />
    ))}
  </div>
);

const KanbanBoardImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [title, setTitle] = useState("Kanban");
  const [columns, setColumns] = useState<Column[]>([]);

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    if (json.title) setTitle(String(json.title));
    if (Array.isArray(json.columns)) setColumns(parseColumns(json.columns));
  }, [result, status.type]);

  const toggleCard = useCallback((colIdx: number, cardId: number) => {
    setColumns((cols) => cols.map((col, ci) =>
      ci !== colIdx ? col : {
        ...col,
        cards: col.cards.map((c) => c.id === cardId ? { ...c, done: !c.done } : c),
      }
    ));
  }, []);

  const removeCard = useCallback((colIdx: number, cardId: number) => {
    setColumns((cols) => cols.map((col, ci) =>
      ci !== colIdx ? col : { ...col, cards: col.cards.filter((c) => c.id !== cardId) }
    ));
  }, []);

  const addCard = useCallback((colIdx: number, text: string) => {
    setColumns((cols) => cols.map((col, ci) =>
      ci !== colIdx ? col : { ...col, cards: [...col.cards, { id: makeId(), text, done: false }] }
    ));
  }, []);

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <LayoutDashboardIcon className="size-3 text-indigo-400" />
        <span className="text-[11px] font-medium text-zinc-300">{title}</span>
        <span className="ml-auto text-[10px] text-zinc-600">{columns.length} columns</span>
      </div>

      {/* Board */}
      <div className="flex gap-2 overflow-x-auto p-3 pb-2" style={{ scrollbarWidth: "thin" }}>
        {columns.map((col, ci) => {
          const accent = COLUMN_ACCENTS[ci % COLUMN_ACCENTS.length];
          const badge = BADGE_ACCENTS[ci % BADGE_ACCENTS.length];
          const done = col.cards.filter((c) => c.done).length;

          return (
            <div
              key={ci}
              className={cn("flex shrink-0 flex-col gap-1.5 rounded-lg border bg-zinc-800/50 p-2 min-w-[140px] w-[160px]", accent)}
            >
              {/* Column header */}
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="flex-1 truncate text-[11px] font-semibold text-zinc-200">{col.name}</span>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums", badge)}>
                  {col.cards.length - done}/{col.cards.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-1">
                {col.cards.map((card) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    onToggle={() => toggleCard(ci, card.id)}
                    onRemove={() => removeCard(ci, card.id)}
                  />
                ))}
              </div>

              {/* Add card */}
              <AddCardInput onAdd={(text) => addCard(ci, text)} />
            </div>
          );
        })}
      </div>
    </DarkShell>
  );
};

export const KanbanBoard = memoWidget(KanbanBoardImpl);
