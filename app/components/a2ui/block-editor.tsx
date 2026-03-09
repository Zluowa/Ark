// @input: Tool result with { content, markdown, blocks, title }
// @output: Notion-style block editor with slash commands and drag handles
// @position: A2UI widget — rich block-level document editing mini-app

"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutListIcon, CopyIcon, CheckIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { DarkShell } from "./dark-shell";
import { memoWidget, unwrapResult } from "./utils";
import { useCopyFeedback } from "./hooks";

// Dynamically import BlockNote to avoid SSR issues with ProseMirror
import dynamic from "next/dynamic";

const BlockNoteEditorInner = dynamic(
  () => import("./block-editor-inner").then((m) => m.BlockNoteEditorInner),
  {
    ssr: false,
    loading: () => (
      <div className="h-48 animate-pulse rounded bg-zinc-800/50" />
    ),
  }
);

const BlockEditorImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const data = unwrapResult(result);
  const { copied, copy } = useCopyFeedback();

  const initialContent = useMemo(() => {
    if (typeof data.markdown === "string") return data.markdown;
    if (typeof data.content === "string") return data.content;
    if (typeof data.text === "string") return data.text;
    return "";
  }, [data]);

  const title = typeof data.title === "string" ? data.title : "Document";

  const handleCopy = () => {
    copy(initialContent);
  };

  const skeleton = (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <LayoutListIcon className="size-3.5 animate-pulse text-blue-400" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-full animate-pulse rounded bg-zinc-800/70" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-800/70" />
      </div>
    </div>
  );

  if (status.type !== "complete" || !initialContent) {
    return (
      <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
        {skeleton}
      </DarkShell>
    );
  }

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton} title={title} icon={<LayoutListIcon className="size-3.5 text-blue-400" />}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <LayoutListIcon className="size-3 text-blue-400" />
        <span className="text-[11px] font-medium text-zinc-300">Block Editor</span>
        {title && <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">{title}</span>}
        <div className="ml-auto">
          <button
            onClick={handleCopy}
            aria-label="Copy content"
            className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      </div>

      {/* Editor area */}
      <div className="h-56 overflow-auto">
        <BlockNoteEditorInner initialMarkdown={initialContent} />
      </div>
    </DarkShell>
  );
};

export const BlockEditor = memoWidget(BlockEditorImpl);
