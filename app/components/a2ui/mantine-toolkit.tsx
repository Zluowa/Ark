// @input: Tool result with { type: "calendar"|"color"|"timer"|"converter", ...config }
// @output: Multi-tool Swiss army knife widget: DatePicker, ColorPicker, Timer, BaseConverter
// @position: A2UI widget — native Mantine components for Calendar and Color tabs

"use client";

import "./mantine-toolkit.css";

import { useState, useEffect, type ReactElement } from "react";
import { useInterval, useClipboard } from "@mantine/hooks";
import { MantineProvider, ColorPicker } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import {
  WrenchIcon, CalendarIcon, PaletteIcon, TimerIcon,
  Binary, CheckIcon, PlayIcon, PauseIcon, RotateCcwIcon,
} from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type ToolType = "calendar" | "color" | "timer" | "converter";

type TabConfig = { id: ToolType; icon: typeof CalendarIcon; label: string; accent: string };

const TABS: TabConfig[] = [
  { id: "calendar",  icon: CalendarIcon, label: "Date",  accent: "text-violet-400" },
  { id: "color",     icon: PaletteIcon,  label: "Color", accent: "text-pink-400"   },
  { id: "timer",     icon: TimerIcon,    label: "Timer", accent: "text-teal-400"   },
  { id: "converter", icon: Binary,       label: "Base",  accent: "text-amber-400"  },
];

// ══════════════════════════════════════════════════════════════════════════════
// Calendar — native @mantine/dates DatePicker
// ══════════════════════════════════════════════════════════════════════════════

function CalendarTool({ initialDate }: { initialDate?: string }) {
  const defaultValue = initialDate
    ? new Date(initialDate).toISOString().slice(0, 10)
    : null;
  const [value, setValue] = useState<string | null>(defaultValue);

  return (
    <div className="flex flex-col items-center px-2 pb-3 pt-1">
      <MantineProvider forceColorScheme="dark">
        <DatePicker
          value={value}
          onChange={setValue}
          size="sm"
        />
      </MantineProvider>
      {value && (
        <div className="mt-2 w-full rounded bg-zinc-800 px-2 py-1 text-center text-[10px] text-violet-300">
          {new Date(value).toLocaleDateString("en-US", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Color — native @mantine/core ColorPicker + hex copy
// ══════════════════════════════════════════════════════════════════════════════

const SWATCHES = [
  "#f472b6", "#f87171", "#fb923c", "#facc15",
  "#4ade80", "#34d399", "#38bdf8", "#818cf8",
  "#a78bfa", "#e879f9", "#ffffff", "#71717a",
];

function ColorTool({ initialColor }: { initialColor?: string }) {
  const defaultColor = initialColor?.startsWith("#") && initialColor.length === 7
    ? initialColor
    : "#a78bfa";
  const [color, setColor] = useState(defaultColor);
  const { copy, copied } = useClipboard({ timeout: 1500 });

  return (
    <div className="flex flex-col items-center gap-2 px-3 pb-3 pt-1">
      <MantineProvider forceColorScheme="dark">
        <ColorPicker
          format="hex"
          value={color}
          onChange={setColor}
          swatches={SWATCHES}
          swatchesPerRow={6}
          size="sm"
          fullWidth
        />
      </MantineProvider>
      <div className="flex w-full items-center gap-2">
        <div
          className="size-7 shrink-0 rounded border border-white/10"
          style={{ background: color }}
        />
        <span className="flex-1 font-mono text-[11px] text-zinc-300">{color}</span>
        <button
          onClick={() => copy(color)}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors",
            copied
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-zinc-800 text-zinc-400 hover:text-white",
          )}
        >
          {copied ? <CheckIcon className="size-3" /> : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Timer — no Mantine equivalent, custom is correct here
// ══════════════════════════════════════════════════════════════════════════════

function TimerTool({ initialSeconds }: { initialSeconds?: number }) {
  const [mode, setMode] = useState<"stopwatch" | "countdown">("stopwatch");
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(initialSeconds ?? 300);
  const [input, setInput] = useState(String(initialSeconds ?? 300));

  const swInterval = useInterval(() => setElapsed(e => e + 1), 1000);
  const cdInterval = useInterval(() => setCountdown(c => {
    if (c <= 1) { cdInterval.stop(); return 0; }
    return c - 1;
  }), 1000);

  const isRunning = mode === "stopwatch" ? swInterval.active : cdInterval.active;

  const toggle = () => mode === "stopwatch" ? swInterval.toggle() : cdInterval.toggle();

  const reset = () => {
    swInterval.stop();
    cdInterval.stop();
    setElapsed(0);
    const secs = parseInt(input, 10) || 300;
    setCountdown(secs);
  };

  const applyInput = () => {
    const secs = parseInt(input, 10) || 300;
    setCountdown(secs);
    setInput(String(secs));
  };

  const display = mode === "stopwatch" ? elapsed : countdown;
  const h = Math.floor(display / 3600);
  const m = Math.floor((display % 3600) / 60);
  const s = display % 60;

  return (
    <div className="space-y-3 px-3 pb-3 pt-2">
      <div className="flex rounded-lg bg-zinc-800 p-0.5 text-[10px]">
        {(["stopwatch", "countdown"] as const).map(mod => (
          <button
            key={mod}
            onClick={() => { setMode(mod); reset(); }}
            className={cn(
              "flex-1 rounded-md py-1 font-medium capitalize transition-colors",
              mode === mod ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {mod}
          </button>
        ))}
      </div>

      <div className={cn(
        "text-center font-mono text-4xl font-bold tabular-nums transition-colors",
        mode === "countdown" && countdown === 0 ? "animate-pulse text-red-400" : "text-zinc-100",
      )}>
        {h > 0 && <span>{String(h).padStart(2, "0")}:</span>}
        <span>{String(m).padStart(2, "0")}</span>
        <span className="text-zinc-400">:</span>
        <span>{String(s).padStart(2, "0")}</span>
      </div>

      {mode === "countdown" && !isRunning && (
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onBlur={applyInput}
            onKeyDown={e => e.key === "Enter" && applyInput()}
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-center text-[11px] text-zinc-200 focus:outline-none focus:ring-1 focus:ring-teal-400/50"
            placeholder="Seconds"
          />
          <span className="text-[10px] text-zinc-500">sec</span>
        </div>
      )}

      <div className="flex justify-center gap-2">
        <button
          onClick={toggle}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-medium transition-colors",
            isRunning
              ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              : "bg-teal-500/20 text-teal-300 hover:bg-teal-500/30",
          )}
        >
          {isRunning ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
          {isRunning ? "Pause" : "Start"}
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <RotateCcwIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Base Converter — no Mantine equivalent, custom is correct here
// ══════════════════════════════════════════════════════════════════════════════

type Base = 2 | 8 | 10 | 16;

const BASES: { base: Base; label: string; prefix: string; accent: string }[] = [
  { base: 2,  label: "BIN", prefix: "0b", accent: "text-amber-400"  },
  { base: 8,  label: "OCT", prefix: "0o", accent: "text-orange-400" },
  { base: 10, label: "DEC", prefix: "",   accent: "text-zinc-200"   },
  { base: 16, label: "HEX", prefix: "0x", accent: "text-cyan-400"   },
];

function ConverterTool({ initialValue }: { initialValue?: number }) {
  const [value, setValue] = useState(initialValue ?? 255);
  const [activeBase, setActiveBase] = useState<Base>(10);
  const [inputStr, setInputStr] = useState(String(initialValue ?? 255));
  const { copy, copied } = useClipboard({ timeout: 1200 });

  const display = (base: Base) => isNaN(value) ? "–" : value.toString(base).toUpperCase();

  const applyInput = (str: string, base: Base) => {
    const n = parseInt(str, base);
    if (!isNaN(n) && n >= 0 && n <= 0xffffffff) setValue(n);
  };

  const isValid = !isNaN(value) && value >= 0 && value <= 0xffffffff;

  return (
    <div className="space-y-2 px-3 pb-3 pt-2">
      <div className="flex gap-1 rounded-lg bg-zinc-800 p-0.5">
        {BASES.map(b => (
          <button
            key={b.base}
            onClick={() => { setActiveBase(b.base); setInputStr(display(b.base).toLowerCase()); }}
            className={cn(
              "flex-1 rounded-md py-0.5 font-mono text-[10px] font-medium transition-colors",
              activeBase === b.base ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded bg-zinc-800 px-2 py-1.5">
        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
          {BASES.find(b => b.base === activeBase)?.prefix}
        </span>
        <input
          value={inputStr}
          onChange={e => { setInputStr(e.target.value); applyInput(e.target.value, activeBase); }}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-zinc-100 focus:outline-none"
          placeholder="Enter value..."
        />
      </div>

      <div className="space-y-1">
        {BASES.map(b => (
          <div
            key={b.base}
            onClick={() => copy(`${b.prefix}${display(b.base)}`)}
            className={cn(
              "flex cursor-pointer items-center justify-between rounded px-2 py-1 transition-colors",
              b.base === activeBase ? "bg-zinc-800/80" : "hover:bg-zinc-800/40",
            )}
          >
            <span className="w-7 text-[9px] font-medium text-zinc-600">{b.label}</span>
            <span className={cn("flex-1 text-right font-mono text-[11px]", b.accent)}>
              {isValid ? display(b.base) : "–"}
            </span>
            {copied && b.base === activeBase && (
              <CheckIcon className="ml-2 size-3 shrink-0 text-emerald-400" />
            )}
          </div>
        ))}
      </div>

      {isValid && (
        <div className="text-center text-[9px] text-zinc-600">
          {value.toString(2).length} bits · {Math.ceil(value.toString(2).length / 8)} bytes
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Widget
// ══════════════════════════════════════════════════════════════════════════════

const skeleton = (
  <div className="space-y-2 px-3 py-2">
    <div className="flex gap-1">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-6 flex-1 animate-pulse rounded bg-zinc-800" />
      ))}
    </div>
    <div className="h-48 animate-pulse rounded bg-zinc-800/50" />
  </div>
);

const MantineToolkitImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [activeTab, setActiveTab] = useState<ToolType>("calendar");
  const [config, setConfig] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    if (json.type && typeof json.type === "string") {
      const t = json.type as ToolType;
      if (TABS.some(tab => tab.id === t)) setActiveTab(t);
    }
    setConfig(json);
  }, [result, status.type]);

  const tabContent: Record<ToolType, ReactElement> = {
    calendar:  <CalendarTool  initialDate={config.date as string}      />,
    color:     <ColorTool     initialColor={config.color as string}     />,
    timer:     <TimerTool     initialSeconds={config.seconds as number} />,
    converter: <ConverterTool initialValue={config.value as number}     />,
  };

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <WrenchIcon className="size-3 text-teal-400" />
        <span className="text-[11px] font-medium text-zinc-300">Toolkit</span>
      </div>

      <div className="flex border-b border-white/5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors",
              activeTab === tab.id
                ? `${tab.accent} -mb-px border-b border-current`
                : "text-zinc-600 hover:text-zinc-400",
            )}
          >
            <tab.icon className="size-3" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="animate-in fade-in duration-200">
        {tabContent[activeTab]}
      </div>
    </DarkShell>
  );
};

export const MantineToolkit = memoWidget(MantineToolkitImpl);
