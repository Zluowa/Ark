// @input: Tool result with { text: string }
// @output: Monospace text card with copy-to-clipboard
// @position: A2UI widget for hash / encode / generate / convert text tools

"use client";

import { useState } from "react";
import { TypeIcon, CopyIcon, CheckIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useCopyFeedback } from "./hooks";
import { memoWidget } from "./utils";
import { DarkShell } from "./dark-shell";

const MAX_LINES = 3;

const extractText = (result: unknown): string | null => {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.text === "string") return r.text;
  if (typeof r.error === "string") return r.error;
  return JSON.stringify(result, null, 2);
};

const TextResultImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopyFeedback();
  const text = extractText(result);

  if (!text) return null;

  const lines = text.split("\n");
  const needsTruncate = lines.length > MAX_LINES && !expanded;
  const display = needsTruncate ? lines.slice(0, MAX_LINES).join("\n") + "…" : text;

  const textSkeleton = (
    <>
      <div className="flex items-center gap-2">
        <TypeIcon className="size-3.5 animate-pulse text-amber-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-2 space-y-1">
        {[80, 60, 70].map((w, i) => (
          <div key={i} className="h-2 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%` }} />
        ))}
      </div>
    </>
  );

  return (
    <DarkShell status={status} maxWidth="md" skeleton={textSkeleton}>
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <TypeIcon className="size-3 text-amber-400" />
        <span className="text-[11px] font-medium text-zinc-300">Text</span>
        <button
          onClick={() => copy(text)}
          aria-label="Copy"
          className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded"
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>
      <div className="px-3 py-2">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-300">
          {display}
        </pre>
        {needsTruncate && (
          <button
            onClick={() => setExpanded(true)}
            className="mt-1 text-[10px] text-amber-400 hover:text-amber-300 transition"
          >
            Show all {lines.length} lines
          </button>
        )}
      </div>
    </DarkShell>
  );
};

export const TextResult = memoWidget(TextResultImpl);
