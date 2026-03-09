// @input: execution result data
// @output: result card with confidence badge, output data, and action buttons
// @position: replaces welcome text after tool execution completes

"use client";

import { Download, RotateCcw, CheckCircle2, AlertCircle, Clock } from "lucide-react";

export interface ExecutionResult {
  toolName: string;
  toolId: string;
  confidence: number;
  method: string;
  summary: string;
  output?: Record<string, unknown>;
  downloadUrl?: string;
  durationMs: number;
}

interface ResultCardProps {
  result: ExecutionResult;
  onRerun: () => void;
}

const ConfidenceBadge = ({ confidence }: { confidence: number }) => {
  const pct = Math.round(confidence * 100);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-yellow-400" : "text-zinc-500";
  return <span className={`text-xs font-mono ${color}`}>{pct}% match</span>;
};

const OutputBlock = ({ output }: { output: Record<string, unknown> }) => {
  const entries = Object.entries(output);
  if (entries.length === 0) return null;

  // Single-value output (e.g. hash result, base64): show prominently
  if (entries.length === 1) {
    const [, value] = entries[0];
    return (
      <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 px-4 py-3 font-mono text-sm break-all whitespace-pre-wrap text-emerald-300">
        {String(value)}
      </pre>
    );
  }

  // Multi-key output: key-value table
  return (
    <div className="mt-3 rounded-lg bg-zinc-950 px-4 py-3 space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-sm">
          <span className="w-24 shrink-0 font-mono text-zinc-500">{key}</span>
          <span className="font-mono text-zinc-300 break-all">{String(value)}</span>
        </div>
      ))}
    </div>
  );
};

export function ResultCard({ result, onRerun }: ResultCardProps) {
  const failed = result.toolName === "Error" || result.toolName === "No match";

  return (
    <div className="w-full rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {failed
            ? <AlertCircle className="size-5 text-red-500 shrink-0" strokeWidth={1.8} />
            : <CheckCircle2 className="size-5 text-emerald-500 shrink-0" strokeWidth={1.8} />
          }
          <span className="text-sm font-medium text-white">{result.toolName}</span>
        </div>
        <div className="flex items-center gap-3">
          {result.confidence > 0 && <ConfidenceBadge confidence={result.confidence} />}
          {result.durationMs > 0 && (
            <span className="flex items-center gap-1 text-xs text-zinc-600">
              <Clock className="size-3" />
              {result.durationMs}ms
            </span>
          )}
        </div>
      </div>

      {/* Summary text */}
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">{result.summary}</p>

      {/* Structured output */}
      {result.output && <OutputBlock output={result.output} />}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        {result.downloadUrl && (
          <a
            href={result.downloadUrl}
            download
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Download className="size-3.5" />
            Download
          </a>
        )}
        <button
          onClick={onRerun}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <RotateCcw className="size-3.5" />
          Run again
        </button>
      </div>
    </div>
  );
}
