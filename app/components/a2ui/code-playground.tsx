// @input: Tool result with { code, language, output? }
// @output: In-chat code sandbox with live execution
// @position: A2UI widget — developer playground mini-app

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon, CopyIcon, CheckIcon, CodeIcon, TerminalIcon, Loader2Icon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { useCopyFeedback } from "./hooks";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type PlaygroundData = { code: string; language: string; output?: string };

const CodePlaygroundImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [data, setData] = useState<PlaygroundData | null>(null);
  const [code, setCode] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const { copied, copy } = useCopyFeedback();
  const [tab, setTab] = useState<"code" | "output">("code");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    const c = String(json.code ?? "");
    if (c) {
      const d = { code: c, language: String(json.language ?? "javascript"), output: json.output ? String(json.output) : undefined };
      setData(d);
      setCode(d.code);
      if (d.output) setOutput(d.output);
    }
  }, [result, status.type]);

  const cleanupRef = useRef<(() => void) | null>(null);

  // Cancel any in-flight execution on unmount
  useEffect(() => () => { cleanupRef.current?.(); }, []);

  const runCode = useCallback(() => {
    if (!code.trim()) return;
    cleanupRef.current?.(); // cancel previous run if any
    setRunning(true);
    setTab("output");
    try {
      // Sandboxed execution via iframe
      const html = `<!DOCTYPE html><html><body><pre id="o"></pre><script>
const _log=[];const _origLog=console.log;
console.log=(...a)=>{_log.push(a.map(x=>typeof x==='object'?JSON.stringify(x,null,2):String(x)).join(' '));};
try{${code}}catch(e){_log.push('Error: '+e.message);}
document.getElementById('o').textContent=_log.join('\\n');
window.parent.postMessage({type:'playground-output',text:_log.join('\\n')},'*');
<\/script></body></html>`;

      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      if (iframeRef.current) iframeRef.current.src = url;

      const cleanup = () => {
        window.removeEventListener("message", handler);
        clearTimeout(timeoutId);
        URL.revokeObjectURL(url);
        cleanupRef.current = null;
      };

      const handler = (e: MessageEvent) => {
        if (e.data?.type !== "playground-output") return;
        if (e.source !== iframeRef.current?.contentWindow) return;
        setOutput(e.data.text || "(no output)");
        setRunning(false);
        cleanup();
      };

      const timeoutId = setTimeout(() => {
        setOutput("⏱ Execution timed out (5s limit)");
        setRunning(false);
        cleanup();
      }, 5000);

      window.addEventListener("message", handler);
      cleanupRef.current = cleanup;
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setRunning(false);
    }
  }, [code]);

  const copyCode = useCallback(() => {
    copy(code);
  }, [code, copy]);

  const skeleton = (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <CodeIcon className="size-3.5 animate-pulse text-emerald-400" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-2 space-y-1">
        {[80, 60, 70, 40].map((w, i) => <div key={i} className="h-2 animate-pulse rounded bg-zinc-800" style={{ width: `${w}%` }} />)}
      </div>
    </div>
  );

  if (!data) return null;

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      <iframe ref={iframeRef} className="hidden" sandbox="allow-scripts" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <CodeIcon className="size-3 text-emerald-400" />
        <span className="text-[11px] font-medium text-zinc-300">Playground</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{data.language}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={copyCode} aria-label="Copy code" className="p-1 text-zinc-600 hover:text-white transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:rounded">
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
          <button onClick={runCode} disabled={running || (data.language !== "javascript" && data.language !== "js")}
            className={cn("flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
              running ? "bg-zinc-700 text-zinc-400" :
              (data.language !== "javascript" && data.language !== "js") ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" :
              "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30")}>
            {running ? <Loader2Icon className="size-2.5 animate-spin" /> : <PlayIcon className="size-2.5" fill="currentColor" />}
            {(data.language !== "javascript" && data.language !== "js") ? "JS only" : "Run"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5">
        {(["code", "output"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("flex items-center gap-1 flex-1 py-1 justify-center text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
              tab === t ? "text-emerald-400 border-b border-emerald-400" : "text-zinc-600 hover:text-zinc-400")}>
            {t === "code" ? <CodeIcon className="size-2.5" /> : <TerminalIcon className="size-2.5" />}
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "code" ? (
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runCode(); } }}
          spellCheck={false}
          aria-label="Code editor"
          className="block h-40 w-full resize-none bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-200 outline-none placeholder-zinc-700"
          placeholder="// Write code here, Ctrl+Enter to run"
        />
      ) : (
        <pre className="h-40 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-300/80 whitespace-pre-wrap">
          {output || "(click Run to execute)"}
        </pre>
      )}
    </DarkShell>
  );
};

export const CodePlayground = memoWidget(CodePlaygroundImpl);
