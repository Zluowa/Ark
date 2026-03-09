// @input: Tool result with { content, markdown, text, title }
// @output: Novel AI writing editor with slash commands and bubble toolbar
// @position: A2UI widget — elegant writing-focused editing mini-app

"use client";

import { useCallback, useMemo, useState } from "react";
import { SparklesIcon, CopyIcon, CheckIcon, BoldIcon, ItalicIcon, UnderlineIcon, CodeIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandList,
  EditorCommandItem,
  EditorBubble,
  EditorBubbleItem,
  type SuggestionItem,
  createSuggestionItems,
  renderItems,
  StarterKit,
  Placeholder,
} from "novel";
import { DarkShell } from "./dark-shell";
import { memoWidget, unwrapResult } from "./utils";
import { useCopyFeedback } from "./hooks";

// Slash command items
const suggestionItems = createSuggestionItems([
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <span className="text-[11px] font-bold text-zinc-300">H1</span>,
    searchTerms: ["h1", "heading", "title"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <span className="text-[11px] font-bold text-zinc-300">H2</span>,
    searchTerms: ["h2", "heading", "subtitle"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list items",
    icon: <span className="text-[11px] text-zinc-300">•</span>,
    searchTerms: ["ul", "list", "bullet"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list items",
    icon: <span className="text-[11px] text-zinc-300">1.</span>,
    searchTerms: ["ol", "list", "numbered", "ordered"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Code Block",
    description: "Syntax-highlighted code",
    icon: <CodeIcon className="size-3 text-zinc-300" />,
    searchTerms: ["code", "codeblock", "pre"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    title: "Blockquote",
    description: "Highlight a quote",
    icon: <span className="text-[11px] text-zinc-300">"</span>,
    searchTerms: ["quote", "blockquote"],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
]);

const extensions = [
  StarterKit,
  Placeholder.configure({ placeholder: "Type '/' for commands…" }),
];

const NovelEditorImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const data = unwrapResult(result);
  const { copied, copy } = useCopyFeedback();
  const [charCount, setCharCount] = useState(0);

  const initialContent = useMemo(() => {
    const md = typeof data.markdown === "string" ? data.markdown
      : typeof data.content === "string" ? data.content
      : typeof data.text === "string" ? data.text
      : "";
    if (!md) return undefined;
    // Novel EditorContent accepts JSONContent; for plain text wrap in paragraphs
    return undefined; // handled via editorProps defaultContent
  }, [data]);

  const defaultContent = useMemo(() => {
    const text = typeof data.markdown === "string" ? data.markdown
      : typeof data.content === "string" ? data.content
      : typeof data.text === "string" ? data.text
      : "";
    if (!text) return undefined;
    // Build minimal Tiptap JSONContent from plain text lines
    const lines = text.split("\n");
    return {
      type: "doc",
      content: lines.map((line) => {
        if (line.startsWith("# ")) return { type: "heading", attrs: { level: 1 }, content: line.slice(2) ? [{ type: "text", text: line.slice(2) }] : [] };
        if (line.startsWith("## ")) return { type: "heading", attrs: { level: 2 }, content: line.slice(3) ? [{ type: "text", text: line.slice(3) }] : [] };
        if (line.startsWith("### ")) return { type: "heading", attrs: { level: 3 }, content: line.slice(4) ? [{ type: "text", text: line.slice(4) }] : [] };
        if (!line.trim()) return { type: "paragraph" };
        return { type: "paragraph", content: [{ type: "text", text: line }] };
      }),
    };
  }, [data]);

  const title = typeof data.title === "string" ? data.title : "Document";

  const skeleton = (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-3.5 animate-pulse text-amber-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-5 w-1/2 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-full animate-pulse rounded bg-zinc-800/70" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-800/70" />
        <div className="h-3 w-full animate-pulse rounded bg-zinc-800/70" />
      </div>
    </div>
  );

  if (status.type !== "complete") {
    return (
      <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
        {skeleton}
      </DarkShell>
    );
  }

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton} title={title} icon={<SparklesIcon className="size-3.5 text-amber-400" />}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <SparklesIcon className="size-3 text-amber-400" />
        <span className="text-[11px] font-medium text-zinc-300">Novel Writer</span>
        {charCount > 0 && (
          <span className="text-[10px] text-zinc-600">{charCount} chars</span>
        )}
        <div className="ml-auto">
          <button
            onClick={() => copy(typeof data.markdown === "string" ? data.markdown : "")}
            aria-label="Copy content"
            className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      </div>

      {/* Novel Editor */}
      <div className="novel-dark h-56 overflow-auto px-1 py-1">
        <EditorRoot>
          <EditorContent
            initialContent={defaultContent as any}
            extensions={extensions}
            immediatelyRender={false}
            className="h-full"
            editorProps={{
              attributes: {
                class: "prose prose-sm prose-invert max-w-none h-full px-3 py-2 text-[12px] text-zinc-200 leading-relaxed outline-none focus:outline-none placeholder:text-zinc-600",
              },
            }}
            onUpdate={({ editor }) => {
              setCharCount(editor.storage.characterCount?.characters?.() ?? 0);
            }}
          >
            {/* Slash command menu */}
            <EditorCommand className="z-50 h-auto max-h-[200px] w-48 overflow-y-auto rounded-lg border border-white/10 bg-zinc-800 px-1 py-1 shadow-xl">
              <EditorCommandEmpty className="px-2 py-1.5 text-[11px] text-zinc-500">
                No results
              </EditorCommandEmpty>
              <EditorCommandList>
                {suggestionItems.map((item) => (
                  <EditorCommandItem
                    key={item.title}
                    value={item.title}
                    onCommand={item.command!}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 aria-selected:bg-zinc-700"
                  >
                    <span className="flex size-5 items-center justify-center rounded bg-zinc-700">
                      {item.icon}
                    </span>
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-[10px] text-zinc-500">{item.description}</p>
                    </div>
                  </EditorCommandItem>
                ))}
              </EditorCommandList>
            </EditorCommand>

            {/* Bubble toolbar */}
            <EditorBubble
              tippyOptions={{
                duration: 100,
                placement: "top",
                appendTo: () => document.body,
              }}
              className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-zinc-800 p-1 shadow-xl"
            >
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleBold().run()}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white cursor-pointer"
              >
                <BoldIcon className="size-3" />
              </EditorBubbleItem>
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleItalic().run()}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white cursor-pointer"
              >
                <ItalicIcon className="size-3" />
              </EditorBubbleItem>
              <EditorBubbleItem
                onSelect={(editor) => editor.chain().focus().toggleCode().run()}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white cursor-pointer"
              >
                <CodeIcon className="size-3" />
              </EditorBubbleItem>
            </EditorBubble>
          </EditorContent>
        </EditorRoot>
      </div>
    </DarkShell>
  );
};

export const NovelEditor = memoWidget(NovelEditorImpl);
