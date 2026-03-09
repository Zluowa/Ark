// @input: Tool result with { title?, kpis, charts, tables } dashboard config
// @output: Tremor data dashboard with KPI cards, charts, and tables
// @position: A2UI widget — data visualization mini-app

"use client";

import { useEffect, useState } from "react";
import { BarChart3Icon, TrendingUpIcon, TrendingDownIcon, MinusIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";
import {
  Card, Metric, Text, Title, Flex, ProgressBar,
  BarChart, LineChart, AreaChart,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Badge, Grid, Col,
} from "@tremor/react";

// --- Types ---

type KPI = {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  progress?: number;
  color?: string;
};

type ChartSeries = { name: string; data: number[] };

type Chart = {
  type: "bar" | "line" | "area";
  title: string;
  categories: string[];
  series: ChartSeries[];
  index?: string;
};

type DataTable = {
  title?: string;
  headers: string[];
  rows: (string | number)[][];
};

type DashboardData = {
  title: string;
  kpis: KPI[];
  charts: Chart[];
  tables: DataTable[];
};

// --- Skeleton ---

const skeleton = (
  <div className="p-3 space-y-3">
    <div className="flex items-center gap-2">
      <BarChart3Icon className="size-3 animate-pulse text-indigo-400" />
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
    </div>
    <div className="grid grid-cols-2 gap-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-800" style={{ animationDelay: `${i * 100}ms` }} />
      ))}
    </div>
    <div className="h-32 animate-pulse rounded-lg bg-zinc-800" style={{ animationDelay: "200ms" }} />
  </div>
);

// --- KPI Delta Icon ---

function DeltaIcon({ change }: { change: number }) {
  if (change > 0) return <TrendingUpIcon className="size-3 text-emerald-400" />;
  if (change < 0) return <TrendingDownIcon className="size-3 text-rose-400" />;
  return <MinusIcon className="size-3 text-zinc-500" />;
}

function deltaColor(change: number) {
  if (change > 0) return "text-emerald-400";
  if (change < 0) return "text-rose-400";
  return "text-zinc-500";
}

// --- KPI Card ---

function KpiCard({ kpi }: { kpi: KPI }) {
  const change = kpi.change ?? 0;
  return (
    <Card className="!bg-zinc-800/60 !border-white/8 !shadow-none p-3 min-h-0">
      <Text className="!text-zinc-400 !text-[10px] truncate">{kpi.label}</Text>
      <Metric className="!text-zinc-100 !text-lg leading-tight mt-0.5">{kpi.value}</Metric>
      {(kpi.change !== undefined || kpi.changeLabel) && (
        <Flex className="mt-1 items-center gap-1">
          <DeltaIcon change={change} />
          <span className={`text-[10px] ${deltaColor(change)}`}>
            {change > 0 ? "+" : ""}{kpi.changeLabel ?? `${change}%`}
          </span>
        </Flex>
      )}
      {kpi.progress !== undefined && (
        <ProgressBar value={kpi.progress} className="mt-2 !h-1" color="indigo" />
      )}
    </Card>
  );
}

// --- Chart Panel ---

const TREMOR_COLORS = ["indigo", "violet", "cyan", "emerald", "rose", "amber"] as const;

function ChartPanel({ chart }: { chart: Chart }) {
  const data = chart.categories.map((cat, i) => {
    const point: Record<string, string | number> = { [chart.index ?? "category"]: cat };
    chart.series.forEach((s) => { point[s.name] = s.data[i] ?? 0; });
    return point;
  });
  const seriesNames = chart.series.map((s) => s.name);
  const colors = TREMOR_COLORS.slice(0, seriesNames.length);
  const sharedProps = {
    data,
    index: chart.index ?? "category",
    categories: seriesNames,
    colors,
    className: "!h-36 mt-2",
    showLegend: seriesNames.length > 1,
    showAnimation: true,
  };

  return (
    <div className="mt-3">
      <Text className="!text-zinc-400 !text-[10px] font-medium">{chart.title}</Text>
      {chart.type === "bar"  && <BarChart  {...sharedProps} />}
      {chart.type === "line" && <LineChart {...sharedProps} />}
      {chart.type === "area" && <AreaChart {...sharedProps} />}
    </div>
  );
}

// --- Table Panel ---

function TablePanel({ table }: { table: DataTable }) {
  return (
    <div className="mt-3">
      {table.title && <Text className="!text-zinc-400 !text-[10px] font-medium mb-1">{table.title}</Text>}
      <Table className="!text-[10px]">
        <TableHead>
          <TableRow>
            {table.headers.map((h, i) => (
              <TableHeaderCell key={i} className="!text-zinc-400 !text-[10px] !py-1 !px-2">{h}</TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {table.rows.map((row, ri) => (
            <TableRow key={ri}>
              {row.map((cell, ci) => (
                <TableCell key={ci} className="!text-zinc-200 !text-[10px] !py-1 !px-2">{String(cell)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Parse result into DashboardData ---

function parseDashboard(result: unknown): DashboardData | null {
  const json = unwrapResult(result);
  if (!json || typeof json !== "object") return null;

  const title = typeof json.title === "string" ? json.title : "Dashboard";
  const kpis: KPI[] = Array.isArray(json.kpis) ? (json.kpis as KPI[]) : [];
  const charts: Chart[] = Array.isArray(json.charts) ? (json.charts as Chart[]) : [];
  const tables: DataTable[] = Array.isArray(json.tables) ? (json.tables as DataTable[]) : [];

  if (kpis.length === 0 && charts.length === 0 && tables.length === 0) return null;
  return { title, kpis, charts, tables };
}

// --- Main Widget ---

const TremorDashboardImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    setDashboard(parseDashboard(result));
  }, [result, status.type]);

  if (!dashboard) return null;

  const pill = {
    icon: BarChart3Icon,
    label: "Dashboard",
    accent: "text-indigo-400",
    bgAccent: "bg-indigo-500/15",
  };

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton} pill={pill} result={result} title={dashboard.title} icon={<BarChart3Icon className="size-4" />}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <BarChart3Icon className="size-3 text-indigo-400" />
        <span className="text-[11px] font-medium text-zinc-300">{dashboard.title}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {dashboard.kpis.length > 0 && (
            <Badge className="!text-[9px] !py-0 !px-1.5 !bg-indigo-500/10 !text-indigo-400 !border-indigo-500/20">
              {dashboard.kpis.length} KPIs
            </Badge>
          )}
        </div>
      </div>

      <div className="p-3 space-y-2 overflow-y-auto max-h-[420px]" style={{ scrollbarWidth: "thin" }}>
        {/* KPI Grid */}
        {dashboard.kpis.length > 0 && (
          <Grid numItems={Math.min(dashboard.kpis.length, 2)} numItemsSm={Math.min(dashboard.kpis.length, 3)} className="gap-2">
            {dashboard.kpis.map((kpi, i) => (
              <Col key={i}>
                <KpiCard kpi={kpi} />
              </Col>
            ))}
          </Grid>
        )}

        {/* Charts */}
        {dashboard.charts.map((chart, i) => (
          <ChartPanel key={i} chart={chart} />
        ))}

        {/* Tables */}
        {dashboard.tables.map((table, i) => (
          <TablePanel key={i} table={table} />
        ))}
      </div>
    </DarkShell>
  );
};

export const TremorDashboard = memoWidget(TremorDashboardImpl);
