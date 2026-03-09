// @input: Tool result with { nodes: [{id, label, group?}], edges: [{source, target, weight?}] }
// @output: Interactive network graph widget with search and node stats
// @position: A2UI widget - graph mini-app powered by Graphology + Sigma

"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { NetworkIcon, SearchIcon, XIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type RawNode = { id: string; label?: string; group?: string | number };
type RawEdge = { source: string; target: string; weight?: number };
type GraphData = { nodes: RawNode[]; edges: RawEdge[] };

const GROUP_COLORS = [
  "#f472b6",
  "#818cf8",
  "#34d399",
  "#fb923c",
  "#38bdf8",
  "#a78bfa",
  "#facc15",
  "#f87171",
];

const groupColor = (group: string | number | undefined, index: number): string => {
  if (group === undefined) return GROUP_COLORS[index % GROUP_COLORS.length];
  const key =
    typeof group === "number"
      ? group
      : [...group].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return GROUP_COLORS[Math.abs(key) % GROUP_COLORS.length];
};

function buildGraph(data: GraphData): Graph {
  const graph = new Graph({ multi: false });
  const nodeSet = new Set(data.nodes.map((node) => node.id));

  data.nodes.forEach((node, index) => {
    graph.addNode(node.id, {
      label: node.label ?? node.id,
      color: groupColor(node.group, index),
      size: 6,
      x: Math.random() * 10 - 5,
      y: Math.random() * 10 - 5,
    });
  });

  data.edges.forEach((edge) => {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) return;
    if (!graph.hasEdge(edge.source, edge.target)) {
      graph.addEdge(edge.source, edge.target, {
        size: 1,
        color: "rgba(255,255,255,0.12)",
      });
    }
  });

  const degrees = new Map<string, number>();
  graph.forEachNode((nodeId) => degrees.set(nodeId, graph.degree(nodeId)));
  const maxDeg = Math.max(...degrees.values(), 1);
  graph.forEachNode((nodeId) => {
    graph.setNodeAttribute(nodeId, "size", 5 + ((degrees.get(nodeId) ?? 0) / maxDeg) * 10);
  });

  forceAtlas2.assign(graph, {
    iterations: 100,
    settings: forceAtlas2.inferSettings(graph),
  });

  return graph;
}

type GraphCanvasProps = {
  graph: Graph;
  search: string;
  onStats: (nodes: number, edges: number) => void;
};

// Load Sigma only in browser to avoid SSR crashes on WebGL globals.
const GraphCanvas = dynamic<GraphCanvasProps>(
  () => import("./graph-viewer-inner").then((module) => module.GraphCanvas),
  {
    ssr: false,
    loading: () => <div className="h-64 animate-pulse rounded bg-zinc-800/50" />,
  },
);

const skeleton = (
  <div className="space-y-2 px-3 py-2">
    <div className="flex items-center gap-2">
      <div className="size-3 animate-pulse rounded bg-zinc-800" />
      <div className="h-2 w-32 animate-pulse rounded bg-zinc-800" />
    </div>
    <div className="h-64 animate-pulse rounded bg-zinc-800/50" />
  </div>
);

const GraphViewerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    const nodes = json.nodes as RawNode[] | undefined;
    const edges = json.edges as RawEdge[] | undefined;
    if (!nodes?.length) return;
    setGraph(buildGraph({ nodes, edges: edges ?? [] }));
  }, [result, status.type]);

  const handleStats = useCallback((nodes: number, edges: number) => {
    setStats({ nodes, edges });
  }, []);

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <NetworkIcon className="size-3 text-pink-400" />
        <span className="text-[11px] font-medium text-zinc-300">Graph</span>
        {stats.nodes > 0 ? (
          <span className="text-[10px] text-zinc-500">
            {stats.nodes} nodes / {stats.edges} edges
          </span>
        ) : null}
      </div>

      <div className="border-b border-white/5 px-3 py-1.5">
        <div className="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1">
          <SearchIcon className="size-3 shrink-0 text-zinc-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search nodes..."
            className="min-w-0 flex-1 bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          {search ? (
            <button
              onClick={() => setSearch("")}
              className="text-zinc-500 hover:text-zinc-300"
              aria-label="Clear search"
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {graph ? (
        <GraphCanvas graph={graph} search={search} onStats={handleStats} />
      ) : (
        <div className="flex h-64 items-center justify-center text-[11px] text-zinc-600">
          No graph data
        </div>
      )}
    </DarkShell>
  );
};

export const GraphViewer = memoWidget(GraphViewerImpl);
