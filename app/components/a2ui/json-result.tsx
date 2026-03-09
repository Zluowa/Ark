// @input: Tool result with { json: Record<string, unknown> }
// @output: Key-value table card for structured data
// @position: A2UI widget for net / timestamp / JWT tools

"use client";

import { BracesIcon, CopyIcon, CheckIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useCopyFeedback } from "./hooks";
import { memoWidget } from "./utils";
import { DarkShell } from "./dark-shell";

const extractJson = (result: unknown): Record<string, unknown> | null => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.json && typeof r.json === "object") return r.json as Record<string, unknown>;
  if (r.error) return null;
  return r;
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const JsonResultImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const { copied, copy } = useCopyFeedback();
  const data = extractJson(result);

  if (!data) return null;

  const jsonSkeleton = (
    <>
      <div className="flex items-center gap-2">
        <BracesIcon className="size-3.5 animate-pulse text-blue-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-2 space-y-1.5">
        {[70, 90, 60, 80].map((w, i) => (
          <div key={i} className="h-2 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%` }} />
        ))}
      </div>
    </>
  );

  return (
    <DarkShell status={status} maxWidth="md" skeleton={jsonSkeleton}>
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <BracesIcon className="size-3 text-blue-400" />
        <span className="text-[11px] font-medium text-zinc-300">JSON</span>
        <button
          onClick={() => copy(JSON.stringify(data, null, 2))}
          aria-label="Copy JSON"
          className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded"
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>
      <table className="w-full">
        <tbody>
          {Object.entries(data).map(([key, value]) => (
            <tr key={key} className="border-b border-white/5 last:border-0">
              <td className="px-3 py-1.5 align-top text-[11px] font-medium text-zinc-500 whitespace-nowrap">
                {key}
              </td>
              <td className="px-3 py-1.5 break-all font-mono text-[11px] text-zinc-300">
                {formatValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DarkShell>
  );
};

export const JsonResult = memoWidget(JsonResultImpl);
