// @input: Tool result data from assistant-ui
// @output: Parsed data, formatting helpers, URL extraction, download trigger
// @position: Shared utilities for all A2UI widget components

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { memo } from "react";

/** Unwrap assistant-ui tool result. Handles both {json: {...}} and direct {...} formats. */
export function unwrapResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  if (r.json && typeof r.json === "object") return r.json as Record<string, unknown>;
  return r;
}

/** Format byte count to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Extract output URL from tool result. Checks output_url, output_file_url, url keys. */
export function extractUrl(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  for (const key of ["output_url", "output_file_url", "preview_url", "url"]) {
    if (typeof r[key] === "string") return r[key] as string;
  }
  return null;
}

/** Trigger browser file download from a URL. */
export function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Type-safe memo wrapper for ToolCallMessagePartComponent. Replaces 16x "as unknown as" casts. */
export function memoWidget(Component: ToolCallMessagePartComponent): ToolCallMessagePartComponent {
  return memo(Component) as unknown as ToolCallMessagePartComponent;
}
