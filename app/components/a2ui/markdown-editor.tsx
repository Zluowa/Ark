// @input: Tool result with { html, markdown, text }
// @output: Split-pane Markdown editor with live preview
// @position: A2UI widget — document editing mini-app

"use client";

import { useCallback, useEffect, useState } from "react";
import { FileTextIcon, CopyIcon, CheckIcon, EyeIcon, EditIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { useCopyFeedback } from "./hooks";
import { memoWidget } from "./utils";
import { DarkShell } from "./dark-shell";

const ALLOWED_TAGS = ["h1","h2","h3","h4","h5","h6","p","a","ul","ol","li","code","pre","em","strong","blockquote","table","thead","tbody","tr","th","td","img","br","hr","span","div","sup","sub"];
const ALLOWED_ATTR = ["href","src","alt","class","id","target","rel"];

const MarkdownEditorImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [source, setSource] = useState("");
  const [html, setHtml] = useState("");
  const [view, setView] = useState<"split" | "preview" | "source">("preview");
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    if (status.type !== "complete") return;
    const data = result as Record<string, unknown> | undefined;
    if (!data) return;
    const md = String(data.markdown ?? data.text ?? data.input ?? "");
    const rendered = String(data.html ?? data.output ?? "");
    if (md || rendered) {
      setSource(md);
      setHtml(DOMPurify.sanitize(rendered, { ALLOWED_TAGS, ALLOWED_ATTR }));
    }
  }, [result, status.type]);

  const copyHtml = useCallback(() => {
    copy(html);
  }, [html, copy]);

  const skeleton = (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <FileTextIcon className="size-3.5 animate-pulse text-blue-400" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-2 h-32 animate-pulse rounded bg-zinc-800/50" />
    </div>
  );

  if (!source && !html) return null;

  const showSource = view === "source" || view === "split";
  const showPreview = view === "preview" || view === "split";

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <FileTextIcon className="size-3 text-blue-400" />
        <span className="text-[11px] font-medium text-zinc-300">Markdown</span>
        <div className="ml-auto flex items-center gap-0.5">
          {(["source", "split", "preview"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              aria-label={v === "source" ? "Source view" : v === "preview" ? "Preview view" : "Split view"}
              className={cn("p-1 rounded transition text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
                view === v ? "bg-blue-500/20 text-blue-400" : "text-zinc-600 hover:text-zinc-400")}>
              {v === "source" ? <EditIcon className="size-3" /> : v === "preview" ? <EyeIcon className="size-3" /> : <span className="px-0.5">⇔</span>}
            </button>
          ))}
          <button onClick={copyHtml} aria-label="Copy HTML" className="p-1 text-zinc-600 hover:text-white transition ml-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={cn("flex", view === "split" ? "divide-x divide-white/5" : "")}>
        {showSource && (
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            className={cn(
              "block h-48 resize-none bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300 outline-none",
              view === "split" ? "w-1/2" : "w-full",
            )}
          />
        )}
        {showPreview && (
          <div
            className={cn(
              "h-48 overflow-auto px-3 py-2 text-[12px] leading-relaxed text-zinc-200",
              "prose prose-sm prose-invert prose-headings:text-zinc-200 prose-a:text-blue-400 prose-code:text-emerald-400 prose-code:bg-zinc-800 prose-code:px-1 prose-code:rounded prose-pre:bg-zinc-800/50 prose-pre:text-[11px]",
              view === "split" ? "w-1/2" : "w-full",
            )}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </DarkShell>
  );
};

export const MarkdownEditor = memoWidget(MarkdownEditorImpl);
