// @input: Tool result with { nodes, edges, title } — React Flow graph data
// @output: Interactive node-based flow editor with dark theme
// @position: A2UI widget for workflow/pipeline visualization and editing

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WorkflowIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

// ── Custom Node Types ───────────────────────────────────────────────────────

type NodeData = {
  label: string;
  description?: string;
};

function DefaultNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  return (
    <div className={`
      rounded-lg border px-3 py-2 min-w-[110px] text-center shadow-lg
      bg-zinc-800/90 text-zinc-100 transition-all
      ${selected ? "border-cyan-400/80 shadow-cyan-400/20" : "border-white/10 shadow-black/40"}
    `}>
      <Handle type="target" position={Position.Top} className="!bg-zinc-500 !border-zinc-400 !w-2 !h-2" />
      <div className="text-[11px] font-semibold leading-tight">{data.label}</div>
      {data.description && (
        <div className="text-[9px] text-zinc-400 mt-0.5 leading-tight">{data.description}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500 !border-zinc-400 !w-2 !h-2" />
    </div>
  );
}

function InputNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  return (
    <div className={`
      rounded-lg border px-3 py-2 min-w-[110px] text-center shadow-lg
      bg-emerald-950/80 text-emerald-100 transition-all
      ${selected ? "border-emerald-400/80 shadow-emerald-400/20" : "border-emerald-500/30 shadow-black/40"}
    `}>
      <div className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold mb-0.5">Input</div>
      <div className="text-[11px] font-semibold leading-tight">{data.label}</div>
      {data.description && (
        <div className="text-[9px] text-emerald-300/60 mt-0.5 leading-tight">{data.description}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !border-emerald-400 !w-2 !h-2" />
    </div>
  );
}

function OutputNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  return (
    <div className={`
      rounded-lg border px-3 py-2 min-w-[110px] text-center shadow-lg
      bg-violet-950/80 text-violet-100 transition-all
      ${selected ? "border-violet-400/80 shadow-violet-400/20" : "border-violet-500/30 shadow-black/40"}
    `}>
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !border-violet-400 !w-2 !h-2" />
      <div className="text-[9px] uppercase tracking-wider text-violet-400 font-bold mb-0.5">Output</div>
      <div className="text-[11px] font-semibold leading-tight">{data.label}</div>
      {data.description && (
        <div className="text-[9px] text-violet-300/60 mt-0.5 leading-tight">{data.description}</div>
      )}
    </div>
  );
}

function ProcessNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  return (
    <div className={`
      rounded-lg border px-3 py-2 min-w-[110px] text-center shadow-lg
      bg-sky-950/80 text-sky-100 transition-all
      ${selected ? "border-sky-400/80 shadow-sky-400/20" : "border-sky-500/30 shadow-black/40"}
    `}>
      <Handle type="target" position={Position.Top} className="!bg-sky-500 !border-sky-400 !w-2 !h-2" />
      <div className="text-[9px] uppercase tracking-wider text-sky-400 font-bold mb-0.5">Process</div>
      <div className="text-[11px] font-semibold leading-tight">{data.label}</div>
      {data.description && (
        <div className="text-[9px] text-sky-300/60 mt-0.5 leading-tight">{data.description}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-sky-500 !border-sky-400 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  default: DefaultNode as never,
  input: InputNode as never,
  output: OutputNode as never,
  process: ProcessNode as never,
};

// ── Default graph when no data ──────────────────────────────────────────────

const DEFAULT_NODES: Node[] = [
  { id: "1", type: "input",   position: { x: 100, y: 50  }, data: { label: "Start" } },
  { id: "2", type: "process", position: { x: 100, y: 160 }, data: { label: "Process" } },
  { id: "3", type: "output",  position: { x: 100, y: 270 }, data: { label: "End" } },
];

const DEFAULT_EDGES: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true },
  { id: "e2-3", source: "2", target: "3", animated: true },
];

// ── Node counter for new nodes ──────────────────────────────────────────────

let nodeCounter = 100;
const nextId = () => `node-${++nodeCounter}`;

// ── Flow Canvas (inner) ─────────────────────────────────────────────────────

function FlowCanvas({ initialNodes, initialEdges }: { initialNodes: Node[]; initialEdges: Edge[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: true }, eds)),
    [setEdges],
  );

  const addNode = useCallback(() => {
    const id = nextId();
    const newNode: Node = {
      id,
      type: "default",
      position: { x: Math.random() * 200 + 50, y: Math.random() * 200 + 50 },
      data: { label: `Node ${id.split("-")[1]}` },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  return (
    <div className="relative" style={{ height: 350 }}>
      {/* Toolbar */}
      <div className="absolute top-2 left-2 z-10 flex gap-1">
        <button
          onClick={addNode}
          className="flex items-center gap-1 rounded-md bg-zinc-700/80 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600/80 hover:text-white transition backdrop-blur-sm border border-white/8"
        >
          <PlusIcon className="size-2.5" />
          Add Node
        </button>
        <button
          onClick={deleteSelected}
          className="flex items-center gap-1 rounded-md bg-zinc-700/80 px-2 py-1 text-[10px] text-zinc-400 hover:bg-red-900/60 hover:text-red-300 transition backdrop-blur-sm border border-white/8"
        >
          <Trash2Icon className="size-2.5" />
          Delete
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        deleteKeyCode="Delete"
        className="rounded-b-xl"
        style={{ background: "transparent" }}
        defaultEdgeOptions={{
          style: { stroke: "#52525b", strokeWidth: 1.5 },
          animated: false,
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="#3f3f46"
        />
        <Controls
          className="!bottom-3 !left-3 !top-auto !shadow-none"
          showInteractive={false}
          style={{
            background: "rgba(39,39,42,0.85)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
          }}
        />
        <MiniMap
          className="!bottom-3 !right-3 !top-auto !shadow-none"
          style={{
            background: "rgba(24,24,27,0.85)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
          }}
          maskColor="rgba(0,0,0,0.5)"
          nodeColor={(n) => {
            const colors: Record<string, string> = {
              input: "#10b981", output: "#8b5cf6", process: "#0ea5e9", default: "#71717a",
            };
            return colors[n.type ?? "default"] ?? "#71717a";
          }}
        />
      </ReactFlow>
    </div>
  );
}

// ── Widget ──────────────────────────────────────────────────────────────────

const skeleton = (
  <div className="px-3 py-2 space-y-2">
    <div className="flex items-center gap-2">
      <div className="size-3 animate-pulse rounded bg-zinc-800" />
      <div className="h-2 w-24 animate-pulse rounded bg-zinc-800" />
    </div>
    <div className="h-[350px] animate-pulse rounded bg-zinc-800/50" />
  </div>
);

const FlowEditorImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [ready, setReady] = useState(false);
  const [initialNodes, setInitialNodes] = useState<Node[]>(DEFAULT_NODES);
  const [initialEdges, setInitialEdges] = useState<Edge[]>(DEFAULT_EDGES);
  const [title, setTitle] = useState("Flow Editor");
  const [nodeCount, setNodeCount] = useState(DEFAULT_NODES.length);

  useEffect(() => {
    if (status.type !== "complete") return;
    const r = unwrapResult(result);

    if (r.title && typeof r.title === "string") setTitle(r.title);

    const rawNodes = r.nodes as Node[] | undefined;
    const rawEdges = r.edges as Edge[] | undefined;

    if (rawNodes?.length) {
      setInitialNodes(rawNodes);
      setInitialEdges(rawEdges ?? []);
      setNodeCount(rawNodes.length);
    }

    setReady(true);
  }, [result, status.type]);

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton} title={title} icon={<WorkflowIcon className="size-3.5 text-cyan-400" />}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <WorkflowIcon className="size-3 text-cyan-400 shrink-0" />
        <span className="text-[11px] font-medium text-zinc-300">{title}</span>
        <span className="text-[10px] text-zinc-500">{nodeCount} nodes</span>
        <div className="ml-auto flex gap-1">
          {(["input", "process", "default", "output"] as const).map((type) => {
            const colors: Record<string, string> = {
              input: "bg-emerald-500/20 text-emerald-400",
              process: "bg-sky-500/20 text-sky-400",
              default: "bg-zinc-500/20 text-zinc-400",
              output: "bg-violet-500/20 text-violet-400",
            };
            return (
              <span key={type} className={`text-[9px] px-1.5 py-0.5 rounded-full ${colors[type]}`}>
                {type}
              </span>
            );
          })}
        </div>
      </div>

      {/* Flow canvas */}
      {ready || status.type === "complete" ? (
        <FlowCanvas initialNodes={initialNodes} initialEdges={initialEdges} />
      ) : (
        <div className="h-[350px] animate-pulse bg-zinc-800/30 rounded-b-xl" />
      )}
    </DarkShell>
  );
};

export const FlowEditor = memoWidget(FlowEditorImpl);
