// @input: Tool result with decoded JWT { header, payload, signature }
// @output: Interactive JWT inspector with color-coded sections
// @position: A2UI widget — developer tool mini-app

"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldIcon, ClockIcon, CopyIcon, CheckIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { useCopyFeedback } from "./hooks";
import { memoWidget, unwrapResult } from "./utils";
import { DarkShell } from "./dark-shell";

type JwtData = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  valid: boolean;
};

const JwtViewerImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [jwt, setJwt] = useState<JwtData | null>(null);
  const [tab, setTab] = useState<"payload" | "header">("payload");
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    if (json.header || json.payload) {
      setJwt({
        header: (json.header ?? {}) as Record<string, unknown>,
        payload: (json.payload ?? {}) as Record<string, unknown>,
        signature: String(json.signature ?? ""),
        valid: json.valid !== false,
      });
    }
  }, [result, status.type]);

  const copySection = useCallback(() => {
    if (!jwt) return;
    const content = tab === "payload" ? jwt.payload : jwt.header;
    copy(JSON.stringify(content, null, 2));
  }, [jwt, tab, copy]);

  const skeleton = (
    <div className="space-y-2">
      <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-800" />
      <div className="h-2 w-full animate-pulse rounded bg-zinc-800" />
      <div className="h-2 w-2/3 animate-pulse rounded bg-zinc-800" />
    </div>
  );

  if (!jwt) return null;

  const exp = jwt.payload.exp ? new Date(Number(jwt.payload.exp) * 1000) : null;
  const isExpired = exp ? exp.getTime() < Date.now() : false;
  const active = tab === "payload" ? jwt.payload : jwt.header;

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton}>
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <ShieldIcon className={cn("size-3", jwt.valid ? "text-emerald-400" : "text-red-400")} />
        <span className="text-[11px] font-medium text-zinc-300">JWT</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", jwt.valid ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
          {jwt.valid ? "valid" : "invalid"}
        </span>
        {exp && (
          <span className={cn("ml-auto flex items-center gap-1 text-[10px]", isExpired ? "text-red-400" : "text-zinc-500")}>
            <ClockIcon className="size-2.5" />
            {isExpired ? "expired" : exp.toLocaleString()}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5">
        {(["payload", "header"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-1.5 text-[10px] font-medium uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
              tab === t ? "text-purple-400 border-b border-purple-400" : "text-zinc-600 hover:text-zinc-400",
            )}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="relative max-h-40 overflow-y-auto px-3 py-2">
        <table className="w-full">
          <tbody>
            {Object.entries(active).map(([k, v]) => (
              <tr key={k} className="border-b border-white/3 last:border-0">
                <td className="py-1 pr-3 text-[10px] font-medium text-purple-400/70 align-top whitespace-nowrap">{k}</td>
                <td className="py-1 text-[10px] text-zinc-300 font-mono break-all">
                  {k === "exp" || k === "iat" || k === "nbf"
                    ? <span title={String(v)}>{new Date(Number(v) * 1000).toLocaleString()}</span>
                    : typeof v === "object" ? JSON.stringify(v) : String(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={copySection} aria-label="Copy section"
          className="absolute top-1.5 right-1.5 p-1 rounded text-zinc-600 hover:text-white hover:bg-white/5 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30">
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>

      {/* Signature preview */}
      <div className="border-t border-white/5 px-3 py-1">
        <p className="truncate font-mono text-[10px] text-zinc-500">sig: {jwt.signature.slice(0, 40)}...</p>
      </div>
    </DarkShell>
  );
};

export const JwtViewer = memoWidget(JwtViewerImpl);
