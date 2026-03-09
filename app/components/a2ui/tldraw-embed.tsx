// @input: topic string, onExportReady callback
// @output: Rendered tldraw editor with dark theme + export capability
// @position: Lazy-loaded tldraw implementation, imported only client-side

"use client";

import "tldraw/tldraw.css";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Tldraw, type Editor, exportAs } from "tldraw";

type Props = {
  topic: string;
  onExportReady: (exportFn: () => void) => void;
};

// Minimal overrides to match zinc-900 dark theme
const DARK_OVERRIDES: CSSProperties = {
  // tldraw uses CSS vars; --color-background controls canvas bg
  ["--color-background" as string]: "#18181b",
  ["--color-low" as string]: "#27272a",
  ["--color-muted-0" as string]: "#3f3f46",
  ["--color-muted-1" as string]: "#52525b",
  ["--color-muted-2" as string]: "#71717a",
  ["--color-text" as string]: "#f4f4f5",
  height: "100%",
  width: "100%",
};

// Serve patched zh-cn translations locally so tldraw doesn't warn about missing keys in dev.
const TLDRAW_ASSET_URL_OVERRIDES = {
  translations: {
    "zh-cn": "/tldraw-zh-cn.json",
  },
};

export default function TldrawEmbed({ topic: _topic, onExportReady }: Props) {
  const editorRef = useRef<Editor | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      // Provide export function to parent
      onExportReady(async () => {
        const ids = editor.getCurrentPageShapeIds();
        const targets = ids.size > 0 ? [...ids] : [];
        if (targets.length === 0) return;
        await exportAs(editor, targets, { format: "png" });
      });
    },
    [onExportReady],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => { editorRef.current = null; };
  }, []);

  return (
    <div style={DARK_OVERRIDES} className="tldraw__editor">
      <Tldraw
        onMount={handleMount}
        inferDarkMode
        hideUi={false}
        assetUrls={TLDRAW_ASSET_URL_OVERRIDES}
      />
    </div>
  );
}
