// @input: Tool result with { title?, cards: Array<{ front: string, back: string }> }
// @output: Interactive flashcard deck with 3D flip animation
// @position: A2UI widget — flashcard deck mini-app

"use client";

import { useEffect, useState, useCallback } from "react";
import { LayersIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type Card = { front: string; back: string };

const skeleton = (
  <div className="p-3 space-y-2">
    <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
    <div className="h-36 animate-pulse rounded-lg bg-zinc-800" />
    <div className="h-1 w-full animate-pulse rounded bg-zinc-800" />
  </div>
);

function CardFace({ text, variant }: { text: string; variant: "front" | "back" }) {
  const isFront = variant === "front";
  const bg = isFront
    ? "bg-gradient-to-br from-fuchsia-500/10 to-purple-500/10 border border-fuchsia-500/20"
    : "bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20";
  const textColor = isFront ? "text-zinc-200 font-medium" : "text-emerald-300";
  const backTransform = isFront ? {} : { transform: "rotateY(180deg)" };

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center rounded-lg p-4 ${bg}`}
      style={{ backfaceVisibility: "hidden", ...backTransform }}
    >
      <p className={`text-sm text-center leading-relaxed ${textColor}`}>{text}</p>
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
    >
      {children}
    </button>
  );
}

const FlashcardDeckImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [cards, setCards] = useState<Card[]>([]);
  const [title, setTitle] = useState("Flashcards");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (status.type !== "complete") return;
    const data = unwrapResult(result);
    if (Array.isArray(data.cards)) setCards(data.cards as Card[]);
    if (data.title) setTitle(String(data.title));
  }, [result, status.type]);

  const goTo = useCallback((next: number) => {
    setIndex(next);
    setFlipped(false);
  }, []);

  const prev = useCallback(() => goTo(index - 1), [index, goTo]);
  const next = useCallback(() => goTo(index + 1), [index, goTo]);
  const flip = useCallback(() => setFlipped((f) => !f), []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); flip(); }
      if (e.key === "ArrowLeft" && index > 0) prev();
      if (e.key === "ArrowRight" && index < cards.length - 1) next();
    },
    [flip, prev, next, index, cards.length]
  );

  const card = cards[index];
  const progress = cards.length > 0 ? (index + 1) / cards.length : 0;

  return (
    <DarkShell status={status} maxWidth="sm" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <LayersIcon className="size-3 text-fuchsia-400" />
          <span className="text-[11px] font-medium text-zinc-400">{title}</span>
        </div>
        {cards.length > 0 && (
          <span className="text-[10px] tabular-nums text-zinc-600">
            {index + 1}/{cards.length}
          </span>
        )}
      </div>

      {/* Card area */}
      <div
        className="px-3 pt-3 pb-1 outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Flashcard — Space to flip, arrows to navigate"
      >
        {card ? (
          <div
            className="relative h-36 cursor-pointer"
            style={{ perspective: "1000px" }}
            onClick={flip}
          >
            <div
              className="relative h-full w-full rounded-lg"
              style={{
                transformStyle: "preserve-3d",
                transition: "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              <CardFace text={card.front} variant="front" />
              <CardFace text={card.back} variant="back" />
            </div>
          </div>
        ) : (
          <div className="h-36 flex items-center justify-center text-[11px] text-zinc-600">
            No cards
          </div>
        )}

        <p className="mt-1 text-center text-[9px] text-zinc-600">
          {flipped ? "Showing answer" : "Click to flip"}
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-2 pb-2">
        <NavButton onClick={prev} disabled={index === 0} label="Previous card">
          <ChevronLeftIcon className="size-4" />
        </NavButton>

        {/* Progress bar */}
        <div className="flex-1 mx-2 h-[3px] rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-fuchsia-500/50 transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <NavButton onClick={next} disabled={index >= cards.length - 1} label="Next card">
          <ChevronRightIcon className="size-4" />
        </NavButton>
      </div>
    </DarkShell>
  );
};

export const FlashcardDeck = memoWidget(FlashcardDeckImpl);
