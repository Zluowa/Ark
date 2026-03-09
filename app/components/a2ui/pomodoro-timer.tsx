// @input: Tool result with optional { minutes, label }
// @output: Circular countdown timer with start/pause/reset
// @position: A2UI widget — focus timer mini-app

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TimerIcon, PlayIcon, PauseIcon, RotateCcwIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget } from "./utils";
import { DarkShell } from "./dark-shell";

type Phase = "work" | "break";

const PomodoroTimerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [total, setTotal] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("work");
  const [label, setLabel] = useState("Focus");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (status.type !== "complete") return;
    const r = result as Record<string, unknown> | undefined;
    if (!r) return;
    const mins = r.minutes ? Number(r.minutes) : 25;
    const secs = Math.max(60, mins * 60);
    setTotal(secs);
    setRemaining(secs);
    if (r.label) setLabel(String(r.label));
  }, [result, status.type]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          const wasWork = phaseRef.current === "work";
          setPhase(wasWork ? "break" : "work");
          return wasWork ? 5 * 60 : total;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, total]);

  const toggle = useCallback(() => setRunning((r) => !r), []);
  const reset = useCallback(() => {
    setRunning(false);
    setPhase("work");
    setRemaining(total);
  }, [total]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const progress = 1 - remaining / (phase === "work" ? total : 5 * 60);
  const circumference = 2 * Math.PI * 44;
  const dashOffset = circumference * (1 - progress);

  const isWork = phase === "work";
  const accent = isWork ? "text-rose-400" : "text-emerald-400";
  const strokeColor = isWork ? "#f43f5e" : "#22c55e";
  const bgStroke = isWork ? "rgba(244,63,94,0.12)" : "rgba(34,197,94,0.12)";

  return (
    <DarkShell
      status={status}
      maxWidth="sm"
      skeleton={<div className="mx-auto size-24 animate-pulse rounded-full bg-zinc-800" />}
    >
      {/* Header */}
      <div className="flex items-center justify-center gap-1.5 py-1.5 border-b border-white/5">
        <TimerIcon className={cn("size-3", accent)} />
        <span className="text-[10px] font-medium text-zinc-400">{label}</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", isWork ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400")}>
          {isWork ? "Focus" : "Break"}
        </span>
      </div>

      {/* Timer circle */}
      <div className="flex flex-col items-center py-4">
        <div className="relative size-24">
          <svg className="size-24 -rotate-90" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="44" fill="none" stroke={bgStroke} strokeWidth="4" />
            <circle cx="48" cy="48" r="44" fill="none" stroke={strokeColor} strokeWidth="4"
              strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset}
              className="transition-all duration-1000 ease-linear" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div aria-live="polite" aria-atomic="true">
              <span className={cn("text-xl font-mono font-bold tabular-nums", accent)}>
                {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
              </span>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mt-3">
          <button onClick={reset} aria-label="Reset timer" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-zinc-600 hover:text-white hover:bg-zinc-800 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
            <RotateCcwIcon className="size-3.5" />
          </button>
          <button onClick={toggle} aria-label={running ? "Pause timer" : "Start timer"}
            className={cn("flex items-center justify-center size-9 rounded-full transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
              isWork ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30" : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30")}>
            {running ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 ml-0.5" fill="currentColor" />}
          </button>
          <div className="size-7" /> {/* Spacer for symmetry */}
        </div>
      </div>
    </DarkShell>
  );
};

export const PomodoroTimer = memoWidget(PomodoroTimerImpl);
