// @input: Tool result with { habits: Array<{ name: string, color?: string }> }
// @output: Interactive habit tracker with daily check-in grid
// @position: A2UI widget — habit tracker mini-app

"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarCheckIcon, CheckIcon, FlameIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type Habit = { name: string; color: string };

const DEFAULT_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4"];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Returns ISO weekday index (0=Mon … 6=Sun) for a given dayOffset from today */
function getDayLabel(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (6 - offset));
  return DAY_LABELS[(d.getDay() + 6) % 7];
}

function getTodayOffset(): number {
  return 6; // last column is always "today"
}

function calcStreak(checked: Set<string>, habitIdx: number): number {
  let streak = 0;
  for (let day = 6; day >= 0; day--) {
    if (!checked.has(`${habitIdx}-${day}`)) break;
    streak++;
  }
  return streak;
}

const skeleton = (
  <div className="space-y-2 p-3">
    <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
    {[...Array(3)].map((_, i) => (
      <div key={i} className="flex gap-1.5">
        <div className="h-6 w-20 animate-pulse rounded bg-zinc-800" style={{ animationDelay: `${i * 80}ms` }} />
        {[...Array(7)].map((__, j) => (
          <div key={j} className="size-6 animate-pulse rounded bg-zinc-800" style={{ animationDelay: `${(i * 7 + j) * 30}ms` }} />
        ))}
      </div>
    ))}
  </div>
);

const HabitTrackerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    const raw = (json.habits as Array<{ name: string; color?: string }>) ?? [];
    setHabits(
      raw.map((h, i) => ({ name: h.name, color: h.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] }))
    );
  }, [result, status.type]);

  const toggle = useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const todayOffset = getTodayOffset();

  return (
    <DarkShell status={status} maxWidth="sm" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-1.5">
        <CalendarCheckIcon className="size-3 text-lime-400" />
        <span className="text-[11px] font-medium text-zinc-400">Habit Tracker</span>
      </div>

      {/* Grid */}
      <div className="p-3 space-y-1">
        {/* Day headers */}
        <div className="flex items-center gap-1">
          <div className="w-[88px]" />
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className={cn(
                "flex size-6 items-center justify-center text-[9px] font-medium",
                i === todayOffset ? "text-lime-500" : "text-zinc-600"
              )}
            >
              {getDayLabel(i)}
            </div>
          ))}
        </div>

        {/* Habit rows */}
        {habits.map((habit, hi) => {
          const streak = calcStreak(checked, hi);
          return (
            <div key={hi} className="flex items-center gap-1">
              {/* Habit label */}
              <div className="flex w-[88px] shrink-0 items-center gap-1.5 overflow-hidden">
                <div className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: habit.color }} />
                <span className="truncate text-[11px] text-zinc-300">{habit.name}</span>
                {streak > 0 && (
                  <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    <FlameIcon className="size-2.5 text-orange-400" />
                    <span className="text-[9px] text-orange-400">{streak}</span>
                  </div>
                )}
              </div>

              {/* Day cells */}
              {Array.from({ length: 7 }, (_, di) => {
                const key = `${hi}-${di}`;
                const done = checked.has(key);
                return (
                  <button
                    key={di}
                    onClick={() => toggle(key)}
                    aria-label={`${habit.name} ${getDayLabel(di)}${done ? " (checked)" : ""}`}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded"
                  >
                    <div
                      className={cn(
                        "flex size-6 items-center justify-center rounded transition-all duration-150",
                        done ? "border-none" : "border border-white/5 bg-zinc-800",
                        di === todayOffset && !done && "border-b-2 border-b-lime-500/40"
                      )}
                      style={done ? { backgroundColor: habit.color + "99" } : undefined}
                    >
                      {done && (
                        <CheckIcon
                          className="size-3 text-white animate-in zoom-in-0 duration-150"
                          strokeWidth={3}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </DarkShell>
  );
};

export const HabitTracker = memoWidget(HabitTrackerImpl);
