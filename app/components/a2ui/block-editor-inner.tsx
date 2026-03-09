// @input: initialMarkdown string
// @output: Fully interactive BlockNote editor (client-only, no SSR)
// @position: Inner implementation for block-editor.tsx dynamic import

"use client";

import { useEffect, useMemo } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

type Props = {
  initialMarkdown: string;
};

export function BlockNoteEditorInner({ initialMarkdown }: Props) {
  const editor = useCreateBlockNote({
    // Start with empty blocks; populate after mount via tryParseMarkdownToBlocks
    initialContent: [{ type: "paragraph", content: "" }],
  });

  useEffect(() => {
    if (!initialMarkdown || !editor) return;
    const blocks = editor.tryParseMarkdownToBlocks(initialMarkdown);
    editor.replaceBlocks(editor.document, blocks);
  }, [initialMarkdown, editor]);

  return (
    <div className="bn-dark h-full [&_.bn-editor]:bg-zinc-900 [&_.bn-editor]:text-zinc-100 [&_.bn-block-outer]:border-zinc-800 [&_.mantine-Menu-dropdown]:bg-zinc-800 [&_.mantine-Menu-item]:text-zinc-200 [&_.mantine-Menu-item:hover]:bg-zinc-700 [&_.bn-slash-menu]:bg-zinc-800 [&_.bn-formatting-toolbar]:bg-zinc-800">
      <BlockNoteView
        editor={editor}
        theme="dark"
        className="h-full"
      />
    </div>
  );
}
