// @input: Tool result with { chart_type, data, title, options }
// @output: Interactive ECharts visualization with zoom/export
// @position: A2UI widget — data visualization mini-app

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3Icon, DownloadIcon, Maximize2 } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult, triggerDownload } from "./utils";
import { WidgetDialog } from "./widget-dialog";

type ChartConfig = {
  type: "bar" | "line" | "pie" | "scatter" | "area";
  title: string;
  data: { labels: string[]; datasets: Array<{ name: string; values: number[] }> };
  options?: Record<string, unknown>;
};

const COLORS = ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#84cc16"];

const ChartBuilderImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<unknown>(null);
  const [config, setConfig] = useState<ChartConfig | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    if (json.chart_type && json.data) {
      setConfig({
        type: (json.chart_type ?? "bar") as ChartConfig["type"],
        title: String(json.title ?? ""),
        data: json.data as ChartConfig["data"],
        options: (json.options ?? {}) as Record<string, unknown>,
      });
    }
  }, [result, status.type]);

  useEffect(() => {
    if (!config || !chartRef.current) return;
    let disposed = false;

    import("echarts").then((echarts) => {
      if (disposed || !chartRef.current) return;
      const chart = echarts.init(chartRef.current, "dark") as { setOption: (o: unknown) => void; resize: () => void; getDataURL: (o: unknown) => string; dispose: () => void };
      instanceRef.current = chart;

      const { type, title, data } = config;
      const isPie = type === "pie";

      const option: Record<string, unknown> = {
        backgroundColor: "transparent",
        title: title ? { text: title, left: "center", top: 8, textStyle: { fontSize: 13, color: "#d4d4d8" } } : undefined,
        tooltip: { trigger: isPie ? "item" : "axis", backgroundColor: "rgba(24,24,27,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { fontSize: 11, color: "#d4d4d8" } },
        legend: data.datasets.length > 1 ? { bottom: 4, textStyle: { fontSize: 10, color: "#71717a" }, itemWidth: 12, itemHeight: 8 } : undefined,
        grid: isPie ? undefined : { left: 48, right: 16, top: title ? 40 : 16, bottom: data.datasets.length > 1 ? 36 : 16 },
        xAxis: isPie ? undefined : { type: "category", data: data.labels, axisLabel: { fontSize: 9, color: "#52525b", rotate: data.labels.length > 8 ? 30 : 0 }, axisLine: { lineStyle: { color: "#27272a" } } },
        yAxis: isPie ? undefined : { type: "value", axisLabel: { fontSize: 9, color: "#52525b" }, splitLine: { lineStyle: { color: "#1e1e22" } } },
        dataZoom: !isPie && data.labels.length > 12 ? [{ type: "inside" }] : undefined,
        series: isPie
          ? [{ type: "pie", radius: ["35%", "60%"], center: ["50%", title ? "55%" : "50%"], label: { fontSize: 10, color: "#a1a1aa" }, data: data.labels.map((name, i) => ({ name, value: data.datasets[0]?.values[i] ?? 0, itemStyle: { color: COLORS[i % COLORS.length] } })) }]
          : data.datasets.map((ds, i) => ({
              name: ds.name,
              type: type === "area" ? "line" : type,
              data: ds.values,
              smooth: type === "line" || type === "area",
              areaStyle: type === "area" ? { opacity: 0.15 } : undefined,
              itemStyle: { color: COLORS[i % COLORS.length] },
              symbolSize: type === "scatter" ? 8 : 4,
            })),
        animationDuration: 600,
      };

      chart.setOption(option);
    });

    const controller = new AbortController();
    const onResize = () => (instanceRef.current as { resize: () => void } | null)?.resize();
    window.addEventListener("resize", onResize, { signal: controller.signal });
    return () => {
      disposed = true;
      controller.abort();
      (instanceRef.current as { dispose: () => void } | null)?.dispose();
    };
  }, [config]);

  useEffect(() => {
    const chart = instanceRef.current as { resize: () => void } | null;
    if (chart?.resize) {
      requestAnimationFrame(() => chart.resize());
    }
  }, [dialogOpen]);

  const exportPng = useCallback(() => {
    const chart = instanceRef.current as { getDataURL: (o: unknown) => string } | null;
    if (!chart) return;
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#18181b" });
    triggerDownload(url, `chart-${Date.now()}.png`);
  }, []);

  if (status.type === "running") {
    return (
      <div className="my-2 mx-auto w-full max-w-md rounded-xl border border-white/8 bg-zinc-900 p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <BarChart3Icon className="size-4 animate-pulse text-blue-500" />
          <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
        </div>
        <div className="mt-3 h-40 animate-pulse rounded bg-zinc-800/50" />
      </div>
    );
  }

  if (!config) return null;

  const content = (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <BarChart3Icon className="size-3 text-blue-400" />
        <span className="text-[11px] font-medium text-zinc-300">{config.title || "Chart"}</span>
        <span className="text-[10px] text-zinc-600">{config.type} · {config.data.labels.length} items</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={exportPng} aria-label="Export chart as PNG" className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            <DownloadIcon className="size-3" />
          </button>
        </div>
      </div>
      <div ref={chartRef} className="w-full h-52" />
    </>
  );

  return (
    <>
      <WidgetDialog open={dialogOpen} onOpenChange={setDialogOpen} title={config.title || "Chart"} icon={<BarChart3Icon className="size-4" />}>
        {content}
      </WidgetDialog>
      <div className="group relative my-2 mx-auto w-full max-w-md overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-xl animate-in fade-in slide-in-from-bottom-1 duration-300">
        <button onClick={() => setDialogOpen(true)} aria-label="Expand"
          className="absolute right-2 top-2 z-10 rounded p-1 text-zinc-600 opacity-0 transition hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 group-hover:opacity-100 touch:opacity-100">
          <Maximize2 className="size-3.5" />
        </button>
        <div className={cn("transition-opacity", dialogOpen && "opacity-30 pointer-events-none")}>
          {content}
        </div>
      </div>
    </>
  );
};

export const ChartBuilder = memoWidget(ChartBuilderImpl);
