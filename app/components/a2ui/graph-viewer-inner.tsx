// @input: Graphology graph + search text
// @output: Sigma-based graph canvas with hover and zoom
// @position: Client-only implementation for graph-viewer to avoid SSR WebGL crashes

"use client";

import { useEffect } from "react";
import type Graph from "graphology";
import { ZoomInIcon, ZoomOutIcon } from "lucide-react";
import {
  SigmaContainer,
  useCamera,
  useLoadGraph,
  useRegisterEvents,
  useSigma,
} from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";

export type GraphCanvasProps = {
  graph: Graph;
  search: string;
  onStats: (nodes: number, edges: number) => void;
};

const SIGMA_SETTINGS = {
  renderEdgeLabels: false,
  defaultEdgeColor: "rgba(255,255,255,0.12)",
  defaultNodeColor: "#818cf8",
  labelFont: "Inter, system-ui, sans-serif",
  labelSize: 10,
  labelWeight: "500",
  labelColor: { color: "#e4e4e7" },
  labelRenderedSizeThreshold: 6,
  stagePadding: 20,
} as const;

function GraphInner({ graph, search, onStats }: GraphCanvasProps) {
  const sigma = useSigma();
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const { zoomIn, zoomOut } = useCamera({ duration: 300, factor: 1.5 });

  useEffect(() => {
    loadGraph(graph);
    onStats(graph.order, graph.size);
  }, [graph, loadGraph, onStats]);

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => {
        sigma.setSetting("nodeReducer", (nodeId, data) => {
          if (nodeId === node) return { ...data, highlighted: true, zIndex: 1 };
          if (graph.neighbors(node).includes(nodeId)) return { ...data, zIndex: 0 };
          return { ...data, color: "rgba(80,80,90,0.4)", label: undefined };
        });
        sigma.setSetting("edgeReducer", (edge, data) => {
          const [source, target] = graph.extremities(edge);
          if (source === node || target === node) {
            return { ...data, color: "rgba(255,255,255,0.4)", size: 2 };
          }
          return { ...data, color: "rgba(255,255,255,0.04)" };
        });
      },
      leaveNode: () => {
        sigma.setSetting("nodeReducer", null);
        sigma.setSetting("edgeReducer", null);
      },
    });
  }, [sigma, graph, registerEvents]);

  useEffect(() => {
    if (!search.trim()) {
      sigma.setSetting("nodeReducer", null);
      return;
    }
    const query = search.toLowerCase();
    sigma.setSetting("nodeReducer", (nodeId, data) => {
      const label = ((data.label as string) ?? "").toLowerCase();
      if (label.includes(query)) return { ...data, highlighted: true, zIndex: 1 };
      return { ...data, color: "rgba(60,60,70,0.3)", label: undefined };
    });
  }, [sigma, search]);

  return (
    <div className="absolute bottom-2 right-2 flex flex-col gap-1">
      <button
        onClick={() => zoomIn()}
        className="flex size-6 items-center justify-center rounded bg-zinc-800/80 text-zinc-400 hover:text-white"
        aria-label="Zoom in"
      >
        <ZoomInIcon className="size-3" />
      </button>
      <button
        onClick={() => zoomOut()}
        className="flex size-6 items-center justify-center rounded bg-zinc-800/80 text-zinc-400 hover:text-white"
        aria-label="Zoom out"
      >
        <ZoomOutIcon className="size-3" />
      </button>
    </div>
  );
}

export function GraphCanvas({ graph, search, onStats }: GraphCanvasProps) {
  return (
    <div className="relative">
      <SigmaContainer
        style={{ height: "256px", background: "transparent" }}
        settings={SIGMA_SETTINGS}
      >
        <GraphInner graph={graph} search={search} onStats={onStats} />
      </SigmaContainer>
    </div>
  );
}
