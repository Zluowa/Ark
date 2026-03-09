// @input: Tool result with { diagram | mermaid | text } — mermaid source code
// @output: Rendered SVG diagram with copy button and type badge
// @position: A2UI widget for diagram generation tools

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GitForkIcon, CopyIcon, CheckIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memoWidget, unwrapResult } from "./utils";
import { useCopyFeedback } from "./hooks";
import { DarkShell } from "./dark-shell";

const DIAGRAM_TYPES = ["flowchart", "sequenceDiagram", "classDiagram", "erDiagram", "gantt", "pie", "graph"] as const;

const detectType = (src: string): string => {
  const first = src.trimStart().split(/\s/)[0]?.toLowerCase() ?? "";
  return DIAGRAM_TYPES.find((t) => t.toLowerCase() === first) ?? "diagram";
};

const MermaidViewerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const rawId = useId();
  const id = `mermaid-${rawId.replace(/:/g, "")}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopyFeedback();

  const r = unwrapResult(result);
  const source = String(r.diagram ?? r.mermaid ?? r.text ?? "");
  const diagramType = detectType(source);

  useEffect(() => {
    if (status.type !== "complete" || !source || !containerRef.current) return;
    let cancelled = false;

    const render = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            primaryColor: "#22d3ee",
            primaryBorderColor: "#0891b2",
            lineColor: "#71717a",
            textColor: "#d4d4d8",
            mainBkg: "#27272a",
          },
        });
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };

    void render();
    return () => { cancelled = true; };
  }, [status.type, source, id]);

  const skeleton = (
    <>
      <div className="flex items-center gap-2 mb-2">
        <GitForkIcon className="size-3.5 animate-pulse text-cyan-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="space-y-1.5">
        {[80, 60, 70, 50].map((w, i) => (
          <div key={i} className="h-2 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%` }} />
        ))}
      </div>
    </>
  );

  if (!source) return null;

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <GitForkIcon className="size-3 text-cyan-400 shrink-0" />
        <span className="text-[11px] font-medium text-zinc-300">Diagram</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">{diagramType}</span>
        <button onClick={() => copy(source)} aria-label="Copy source"
          className="ml-auto p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>
      {/* SVG body */}
      <div className="max-h-80 overflow-auto p-3">
        {error ? (
          <pre className="text-[10px] text-red-400 font-mono whitespace-pre-wrap">{error}</pre>
        ) : (
          <div ref={containerRef} className="flex justify-center [&>svg]:max-w-full [&>svg]:h-auto" />
        )}
      </div>
    </DarkShell>
  );
};

export const MermaidViewer = memoWidget(MermaidViewerImpl);
