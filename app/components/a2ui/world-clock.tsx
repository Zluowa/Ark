// @input: Tool result with { cities: Array<{ name: string, timezone: string }> }
// @output: Live analog clocks for multiple timezones
// @position: A2UI widget — world clock mini-app

"use client";

import { useEffect, useState } from "react";
import { GlobeIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

// ---------- types ----------

type City = { name: string; timezone: string };
type HMS = { h: number; m: number; s: number };

// ---------- helpers ----------

function getHMS(tz: string): HMS {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return {
    h: Number(parts.hour) % 24,
    m: Number(parts.minute),
    s: Number(parts.second),
  };
}

function handAngles(h: number, m: number, s: number) {
  return {
    hour: (h % 12) * 30 + m * 0.5,
    minute: m * 6 + s * 0.1,
    second: s * 6,
  };
}

// ---------- sub-components ----------

const HOUR_MARKS = Array.from({ length: 12 }, (_, i) => i);

function ClockFace({ tz }: { tz: string }) {
  const [hms, setHms] = useState<HMS>(() => {
    try { return getHMS(tz); } catch { return { h: 0, m: 0, s: 0 }; }
  });

  useEffect(() => {
    const id = setInterval(() => {
      try { setHms(getHMS(tz)); } catch { /* ignore invalid tz */ }
    }, 1000);
    return () => clearInterval(id);
  }, [tz]);

  const { hour, minute, second } = handAngles(hms.h, hms.m, hms.s);
  const digital = `${String(hms.h).padStart(2, "0")}:${String(hms.m).padStart(2, "0")}:${String(hms.s).padStart(2, "0")}`;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="80" height="80" viewBox="0 0 80 80" aria-label={`Clock for ${tz}`}>
        {/* Face */}
        <circle cx="40" cy="40" r="37" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />

        {/* Hour marks */}
        {HOUR_MARKS.map((i) => {
          const a = (i * 30 * Math.PI) / 180;
          const outer = 37;
          const inner = 31;
          return (
            <line
              key={i}
              x1={40 + inner * Math.sin(a)}
              y1={40 - inner * Math.cos(a)}
              x2={40 + outer * Math.sin(a)}
              y2={40 - outer * Math.cos(a)}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={i % 3 === 0 ? 1.5 : 0.8}
            />
          );
        })}

        {/* Hour hand */}
        <line
          x1="40" y1="40" x2="40" y2="19"
          stroke="#d4d4d8" strokeWidth="2.5" strokeLinecap="round"
          transform={`rotate(${hour} 40 40)`}
        />

        {/* Minute hand */}
        <line
          x1="40" y1="40" x2="40" y2="13"
          stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round"
          transform={`rotate(${minute} 40 40)`}
        />

        {/* Second hand — key on integer second to prevent cross-0 backward sweep */}
        <line
          key={hms.s}
          x1="40" y1="44" x2="40" y2="10"
          stroke="#38bdf8" strokeWidth="0.8" strokeLinecap="round"
          transform={`rotate(${second} 40 40)`}
          style={{ transition: "transform 1s linear" }}
        />

        {/* Center dot */}
        <circle cx="40" cy="40" r="2" fill="#38bdf8" />
      </svg>

      <span className="text-[11px] font-medium text-zinc-300 text-center leading-tight max-w-[80px] truncate" title={tz}>
        {tz.split("/").pop()?.replace(/_/g, " ") ?? tz}
      </span>
      <span className="text-[10px] text-zinc-500 tabular-nums">{digital}</span>
    </div>
  );
}

// ---------- skeleton ----------

const skeleton = (
  <div className="flex gap-4 justify-center p-4">
    {[...Array(3)].map((_, i) => (
      <div key={i} className="flex flex-col items-center gap-1.5">
        <div className="size-[80px] rounded-full animate-pulse bg-zinc-800" />
        <div className="h-3 w-16 rounded animate-pulse bg-zinc-800" />
        <div className="h-2.5 w-14 rounded animate-pulse bg-zinc-800" />
      </div>
    ))}
  </div>
);

// ---------- widget ----------

const WorldClockImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [cities, setCities] = useState<City[]>([]);

  useEffect(() => {
    if (status.type !== "complete") return;
    const data = unwrapResult(result);
    const raw = data.cities;
    if (Array.isArray(raw)) setCities(raw as City[]);
  }, [result, status.type]);

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center justify-center gap-1.5 py-1.5 border-b border-white/5">
        <GlobeIcon className="size-3 text-sky-400" />
        <span className="text-[11px] font-medium text-zinc-400">World Clock</span>
      </div>

      {/* Clocks */}
      <div className="flex flex-wrap justify-center gap-4 p-4">
        {cities.map((city) => (
          <ClockFace key={city.timezone} tz={city.timezone} />
        ))}
      </div>
    </DarkShell>
  );
};

export const WorldClock = memoWidget(WorldClockImpl);
