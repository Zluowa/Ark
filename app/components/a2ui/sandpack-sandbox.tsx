// @input: Tool result with { code, files?, template?, dependencies? }
// @output: Full-featured Sandpack code sandbox with live preview
// @position: A2UI widget — Sandpack-powered interactive code sandbox

"use client";

import { useEffect, useState } from "react";
import {
  SandpackProvider,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackLayout,
  SandpackConsole,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { sandpackDark } from "@codesandbox/sandpack-themes";
import { CodeIcon, EyeIcon, TerminalIcon, RefreshCwIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type SandpackTemplate = "react" | "react-ts" | "vanilla" | "vanilla-ts" | "vue" | "vue-ts" | "svelte" | "node";

type SandpackData = {
  template: SandpackTemplate;
  files: Record<string, string>;
  dependencies: Record<string, string>;
  activeFile?: string;
};

const TEMPLATE_LABELS: Record<SandpackTemplate, string> = {
  react: "React",
  "react-ts": "React+TS",
  vanilla: "Vanilla JS",
  "vanilla-ts": "Vanilla+TS",
  vue: "Vue",
  "vue-ts": "Vue+TS",
  svelte: "Svelte",
  node: "Node.js",
};

const TEMPLATE_ACCENT: Record<SandpackTemplate, string> = {
  react: "text-cyan-400",
  "react-ts": "text-blue-400",
  vanilla: "text-yellow-400",
  "vanilla-ts": "text-yellow-300",
  vue: "text-emerald-400",
  "vue-ts": "text-green-400",
  svelte: "text-orange-400",
  node: "text-lime-400",
};

function RefreshButton() {
  const { sandpack } = useSandpack();
  return (
    <button
      onClick={() => sandpack.resetAllFiles()}
      aria-label="Reset files"
      className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded"
    >
      <RefreshCwIcon className="size-3" />
    </button>
  );
}

type PanelTab = "editor" | "preview" | "console";

function SandpackInner({ data }: { data: SandpackData }) {
  const [tab, setTab] = useState<PanelTab>("editor");

  const tabs: { id: PanelTab; icon: React.ReactNode; label: string }[] = [
    { id: "editor", icon: <CodeIcon className="size-2.5" />, label: "Editor" },
    { id: "preview", icon: <EyeIcon className="size-2.5" />, label: "Preview" },
    { id: "console", icon: <TerminalIcon className="size-2.5" />, label: "Console" },
  ];

  const accent = TEMPLATE_ACCENT[data.template] ?? "text-green-400";
  const label = TEMPLATE_LABELS[data.template] ?? data.template;

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <CodeIcon className={cn("size-3", accent)} />
        <span className="text-[11px] font-medium text-zinc-300">Sandbox</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full bg-white/5", accent)}>
          {label}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <RefreshButton />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5">
        {tabs.map(({ id, icon, label: tabLabel }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1 flex-1 py-1 justify-center text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
              tab === id ? `${accent} border-b border-current` : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            {icon}
            {tabLabel}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="h-56">
        <SandpackLayout style={{ margin: 0, border: "none", borderRadius: 0, background: "transparent" }}>
          <div className={cn("h-56 w-full", tab !== "editor" && "hidden")}>
            <SandpackCodeEditor
              style={{ height: "100%", background: "transparent" }}
              showLineNumbers
              showInlineErrors
              wrapContent
            />
          </div>
          <div className={cn("h-56 w-full", tab !== "preview" && "hidden")}>
            <SandpackPreview
              style={{ height: "100%" }}
              showRefreshButton={false}
              showOpenInCodeSandbox={false}
            />
          </div>
          <div className={cn("h-56 w-full overflow-auto", tab !== "console" && "hidden")}>
            <SandpackConsole style={{ height: "100%", background: "transparent" }} />
          </div>
        </SandpackLayout>
      </div>
    </>
  );
}

const SandpackSandboxImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<SandpackData | null>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);

    const rawFiles = json.files as Record<string, unknown> | undefined;
    const files: Record<string, string> = {};
    if (rawFiles && typeof rawFiles === "object") {
      for (const [k, v] of Object.entries(rawFiles)) {
        files[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
    }

    // Fallback: single code field
    if (Object.keys(files).length === 0 && json.code) {
      const lang = String(json.language ?? "js");
      const ext = lang === "typescript" || lang === "ts" ? "ts" : "js";
      const isReact = lang === "tsx" || lang === "jsx" || String(json.template ?? "").includes("react");
      files[isReact ? `/App.${lang === "tsx" ? "tsx" : "jsx"}` : `/index.${ext}`] = String(json.code);
    }

    const template = (json.template as SandpackTemplate) ?? detectTemplate(files);
    const dependencies = (json.dependencies as Record<string, string>) ?? {};

    setData({ template, files, dependencies, activeFile: json.active_file as string | undefined });
  }, [result, status.type]);

  const skeleton = (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <CodeIcon className="size-3.5 animate-pulse text-green-400" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-32 flex-1 animate-pulse rounded bg-zinc-800" />
        <div className="h-32 flex-1 animate-pulse rounded bg-zinc-800" />
      </div>
    </div>
  );

  if (!data) {
    return (
      <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
        {null}
      </DarkShell>
    );
  }

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton} title="Sandpack Sandbox">
      <SandpackProvider
        template={data.template}
        files={data.files}
        customSetup={{ dependencies: data.dependencies }}
        options={{ activeFile: data.activeFile }}
        theme={sandpackDark}
      >
        <SandpackInner data={data} />
      </SandpackProvider>
    </DarkShell>
  );
};

function detectTemplate(files: Record<string, string>): SandpackTemplate {
  const keys = Object.keys(files).join(" ");
  if (keys.includes(".vue")) return "vue";
  if (keys.includes(".svelte")) return "svelte";
  if (keys.includes(".tsx")) return "react-ts";
  if (keys.includes(".jsx") || keys.includes("App.js")) return "react";
  if (keys.includes(".ts")) return "vanilla-ts";
  return "vanilla";
}

export const SandpackSandbox = memoWidget(SandpackSandboxImpl);
