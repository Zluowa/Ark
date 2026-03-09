// @input: Tool result with { target: ISO 8601 string, label: string }
// @output: Animated countdown display with days/hours/minutes/seconds
// @position: A2UI widget — countdown timer mini-app

"use client";

import { useEffect, useState } from "react";
import { HourglassIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type TimeLeft = { days: number; hours: number; minutes: number; seconds: number };

function calcTimeLeft(target: Date): TimeLeft | null {
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return null;
  const s = Math.floor(diff / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

const UNITS = ["Days", "Hours", "Minutes", "Seconds"] as const;

function TimeBox({ value, unit }: { value: number; unit: string }) {
  const display = String(value).padStart(2, "0");
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="bg-zinc-800 rounded-lg px-3 py-2 min-w-[52px] text-center">
        <span
          key={display}
          className="block text-xl font-mono font-bold tabular-nums text-amber-300 transition-all duration-300"
        >
          {display}
        </span>
      </div>
      <span className="text-[9px] text-zinc-400 uppercase tracking-wider">{unit}</span>
    </div>
  );
}

function Separator() {
  return (
    <span className="text-zinc-400 text-lg animate-pulse self-start mt-2">:</span>
  );
}

const skeleton = (
  <div className="flex items-center justify-center gap-2 p-4">
    {[...Array(4)].map((_, i) => (
      <div key={i} className="h-14 w-14 animate-pulse rounded-lg bg-zinc-800" />
    ))}
  </div>
);

const CountdownTimerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [target, setTarget] = useState<Date | null>(null);
  const [label, setLabel] = useState("Countdown");
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null | "expired">(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const data = unwrapResult(result);
    const date = new Date(String(data.target ?? ""));
    if (!isNaN(date.getTime())) setTarget(date);
    if (data.label) setLabel(String(data.label));
  }, [result, status.type]);

  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const left = calcTimeLeft(target);
      setTimeLeft(left ?? "expired");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const values = timeLeft && timeLeft !== "expired"
    ? [timeLeft.days, timeLeft.hours, timeLeft.minutes, timeLeft.seconds]
    : null;

  return (
    <DarkShell status={status} maxWidth="sm" skeleton={skeleton}>
      <div className="flex items-center justify-center gap-1.5 py-1.5 border-b border-white/5">
        <HourglassIcon className="size-3 text-amber-400" />
        <span className="text-[11px] font-medium text-zinc-200">{label}</span>
      </div>

      <div className="flex flex-col items-center py-4 px-3">
        {timeLeft === "expired" ? (
          <Expired />
        ) : values ? (
          <div className="flex items-start gap-1">
            {UNITS.map((unit, i) => (
              <div key={unit} className="flex items-start gap-1">
                <TimeBox value={values[i]} unit={unit} />
                {i < UNITS.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        ) : (
          <div className="h-16 animate-pulse rounded bg-zinc-800 w-full" />
        )}
      </div>
    </DarkShell>
  );
};

function Expired() {
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="relative">
        <span className="text-2xl font-bold text-zinc-300">Time's up!</span>
        <span
          className="absolute -top-2 -right-3 text-lg"
          style={{ animation: "sparkle 1.2s ease-in-out infinite alternate" }}
        >
          ✦
        </span>
        <style>{`
          @keyframes sparkle {
            from { opacity: 0.3; transform: scale(0.8) rotate(-15deg); }
            to   { opacity: 1;   transform: scale(1.2) rotate(15deg); }
          }
        `}</style>
      </div>
      <span className="text-[10px] text-zinc-400 uppercase tracking-widest">Expired</span>
    </div>
  );
}

export const CountdownTimer = memoWidget(CountdownTimerImpl);
