// @input: ToolManifest from server component
// @output: Full-page tool experience — widget, file drop, or text input
// @position: Client component for /dashboard/tools/[id] route

"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, UploadIcon, Loader2Icon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolManifest } from "@/lib/engine/types";
import { widgetRegistry } from "@/components/a2ui/registry";
import { TOOL_DEFAULTS } from "./tool-defaults";
import { CATEGORY_COLORS } from "@/lib/tools/display";
import { useLocaleStore, useT } from "@/lib/i18n";
import { executeToolSync, uploadToolInputFiles } from "@/lib/api/tooling";
import { extractUrl } from "@/components/a2ui/utils";
import { SaveButton } from "@/components/a2ui/save-button";
import { getLocalizedToolText } from "@/lib/tools/localization";
import { IOPaintStudio } from "./iopaint-studio";

type Phase = "idle" | "uploading" | "running" | "done" | "error";

const toWidgetKey = (id: string) => id.replace(/\./g, "_");
const complete = { type: "complete" as const };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = (props: any) => props;

const isEmptyValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
};

const pickAutoValue = (param: ToolManifest["params"][number]): unknown => {
  if (param.default !== undefined) return param.default;
  if (param.type === "enum" && Array.isArray(param.enum_values) && param.enum_values.length > 0) {
    return param.enum_values[0];
  }
  if (param.type === "number") {
    if (typeof param.min === "number" && Number.isFinite(param.min)) return param.min;
    return 1;
  }
  if (param.type === "boolean") return false;
  return undefined;
};

// ── Header ──────────────────────────────────────────────────────────────

function ToolHeader({ tool }: { tool: ToolManifest }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const colors = CATEGORY_COLORS[tool.category] ?? "bg-muted text-muted-foreground";
  const key = `category.${tool.category}` as Parameters<typeof t>[0];
  const label = t(key);
  const localized = getLocalizedToolText(tool, locale);

  return (
    <div className="flex items-center gap-3 border-white/10 border-b bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.14),transparent_26%),linear-gradient(180deg,rgba(8,12,18,0.98),rgba(6,10,14,0.96))] px-6 py-4 text-white">
      <button
        onClick={() => router.push("/dashboard/tools")}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-white/62 transition-colors hover:text-white"
      >
        <ArrowLeft className="size-3.5" />
        <span>{t("standalone.back")}</span>
      </button>
      <span className="text-white/18">|</span>
      <span className="text-sm font-medium text-white">{localized.name}</span>
      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", colors)}>{label}</span>
    </div>
  );
}

// ── Mode A: Widget direct render ────────────────────────────────────────

function WidgetMode({ widgetKey }: { tool: ToolManifest; widgetKey: string }) {
  const entry = widgetRegistry[widgetKey];
  if (!entry) return null;
  const Widget = entry.component;
  const defaults = TOOL_DEFAULTS[widgetKey] ?? {};

  return (
    <div className="flex-1 overflow-hidden">
      <Widget {...P({ toolName: widgetKey, status: complete, result: defaults })} />
    </div>
  );
}

// ── Mode B: File drop ───────────────────────────────────────────────────

function FileDropMode({ tool, widgetKey }: { tool: ToolManifest; widgetKey: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fileParam = tool.params.find(p => p.type === "file");
  const allowsMultiple =
    tool.id.endsWith("_batch") ||
    tool.id.endsWith(".batch") ||
    tool.id.includes("batch") ||
    fileParam?.name === "file_urls";

  const t = useT();

  const processFiles = useCallback(async (files: File[]) => {
    try {
      setPhase("uploading");
      setError(null);
      const uploaded = await uploadToolInputFiles(files, tool.id);
      if (uploaded.length === 0) { setPhase("error"); setError(t("standalone.uploadFailed")); return; }

      // Build params with defaults for non-file params
      const params: Record<string, unknown> = {};
      const fileParamName = fileParam?.name ?? "file_url";
      if (allowsMultiple) {
        params[fileParamName] = uploaded.map((item) => item.executor_url ?? item.url);
        params.filenames = uploaded.map((item) => item.name);
      } else {
        params[fileParamName] = uploaded[0].executor_url ?? uploaded[0].url;
        params.filenames = [uploaded[0].name];
      }
      for (const p of tool.params) {
        if (p.type === "file") continue;
        const autoValue = pickAutoValue(p);
        if (autoValue !== undefined) params[p.name] = autoValue;
      }
      const missing = tool.params.filter(
        (p) => p.type !== "file" && p.required && isEmptyValue(params[p.name]),
      );
      if (missing.length > 0) {
        setPhase("error");
        setError(`${t("standalone.missingParams")}: ${missing.map((p) => p.name).join(", ")}`);
        return;
      }

      setPhase("running");
      const res = await executeToolSync(tool.id, params);
      if (res.status === "success") {
        setResult(res.result);
        setPhase("done");
      } else {
        setError(res.error.message);
        setPhase("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("standalone.failed"));
      setPhase("error");
    }
  }, [tool, fileParam, allowsMultiple, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) processFiles(allowsMultiple ? files : files.slice(0, 1));
  }, [processFiles, allowsMultiple]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) processFiles(allowsMultiple ? files : files.slice(0, 1));
  }, [processFiles, allowsMultiple]);

  const busy = phase === "uploading" || phase === "running";
  const entry = widgetRegistry[widgetKey];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8">
      {/* Drop zone */}
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[28px] border-2 border-dashed p-14 text-white transition-[border-color,background-color,transform]",
          busy ? "cursor-wait border-zinc-700 bg-zinc-900/50" :
          dragOver ? "border-sky-300/70 bg-sky-300/10" :
          "border-white/12 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.12),transparent_22%),linear-gradient(180deg,rgba(8,12,18,0.92),rgba(6,10,14,0.92))] hover:-translate-y-0.5 hover:border-white/22",
        )}>
        {busy ? (
          <>
            <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {phase === "uploading" ? t("standalone.uploading") : t("standalone.processing")}
            </span>
          </>
        ) : (
          <>
            <UploadIcon className="size-8 text-muted-foreground/50" />
            <span className="text-sm text-muted-foreground">
              {allowsMultiple ? "Drop one or more files here or click to upload" : t("standalone.dropHint")}
            </span>
            {fileParam?.accept && (
              <span className="text-[11px] text-muted-foreground/40">
                {fileParam.accept.join(", ")}
              </span>
            )}
          </>
        )}
        <input ref={inputRef} type="file" className="hidden"
          multiple={allowsMultiple}
          accept={fileParam?.accept?.join(",") ?? undefined}
          onChange={handleFileChange} />
      </div>

      {/* Result widget */}
      {phase === "done" && result && entry && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2Icon className="size-3.5" />
            <span>{t("standalone.done")}</span>
          </div>
          <entry.component {...P({ toolName: widgetKey, status: complete, result })} />
        </div>
      )}

      {/* Fallback result display (no widget) */}
      {phase === "done" && result && !entry && (
        <FallbackResult result={result} />
      )}

      {/* Error */}
      {phase === "error" && error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ── Mode C: Text input ──────────────────────────────────────────────────

function TextInputMode({ tool, widgetKey }: { tool: ToolManifest; widgetKey: string }) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const optionalFileInputRef = useRef<HTMLInputElement>(null);

  const primaryParam = tool.params.find(p => p.required) ?? tool.params[0];
  const optionalFileParam = tool.params.find((p) => p.type === "file");
  const requiresTextInput = primaryParam?.type !== "file";

  const handleSubmit = useCallback(async () => {
    if (requiresTextInput && !input.trim()) return;
    try {
      setPhase("running");
      setError(null);
      const params: Record<string, unknown> = {};
      if (primaryParam?.type !== "file") {
        params[primaryParam.name] = input;
      }
      if (optionalFileParam && attachedFile) {
        const uploaded = await uploadToolInputFiles([attachedFile], tool.id);
        if (uploaded.length === 0) {
          setError(t("standalone.uploadFailed"));
          setPhase("error");
          return;
        }
        params[optionalFileParam.name] = uploaded[0].executor_url ?? uploaded[0].url;
        params.filenames = [uploaded[0].name];
      }
      for (const p of tool.params) {
        if (p === primaryParam) continue;
        if (p.type === "file") continue;
        const autoValue = pickAutoValue(p);
        if (autoValue !== undefined) params[p.name] = autoValue;
      }
      const missing = tool.params.filter(
        (p) => p.type !== "file" && p.required && isEmptyValue(params[p.name]),
      );
      if (missing.length > 0) {
        setError(`${t("standalone.missingParams")}: ${missing.map((p) => p.name).join(", ")}`);
        setPhase("error");
        return;
      }
      const res = await executeToolSync(tool.id, params);
      if (res.status === "success") {
        setResult(res.result);
        setPhase("done");
      } else {
        setError(res.error.message);
        setPhase("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("standalone.failed"));
      setPhase("error");
    }
  }, [tool, input, primaryParam, optionalFileParam, attachedFile, requiresTextInput, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }, [handleSubmit]);

  const entry = widgetRegistry[widgetKey];
  const busy = phase === "running";
  const canRun = busy ? false : requiresTextInput ? Boolean(input.trim()) : true;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8">
      <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.16),transparent_24%),linear-gradient(180deg,rgba(8,12,18,0.98),rgba(5,8,12,0.98))] p-2 shadow-[0_20px_80px_rgba(0,0,0,0.32)]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={locale === "zh" ? t("standalone.inputPlaceholder") : (primaryParam?.description ?? t("standalone.inputPlaceholder"))}
          rows={4}
          className="w-full resize-none bg-transparent px-4 py-4 text-[15px] leading-6 text-white outline-none placeholder:text-zinc-500"
        />
        <button
          onClick={handleSubmit}
          disabled={!canRun}
          className={cn(
            "absolute bottom-4 right-4 rounded-2xl px-4 py-2 text-xs font-medium transition-colors",
            busy ? "cursor-wait bg-zinc-700 text-zinc-400" :
            "bg-[linear-gradient(135deg,#0ea5e9,#22c55e)] text-white shadow-[0_10px_30px_rgba(14,165,233,0.28)] hover:opacity-95 disabled:opacity-40",
          )}
        >
          {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : t("standalone.run")}
        </button>
      </div>

      {optionalFileParam && (
        <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-3 text-white">
          <button
            onClick={() => optionalFileInputRef.current?.click()}
            className="rounded-2xl border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:border-white/25"
          >
            {t("standalone.attachFile")}
          </button>
          <span className="max-w-[70%] truncate text-xs text-white/54">
            {attachedFile ? `${t("standalone.fileAttached")}: ${attachedFile.name}` : t("standalone.fileOptional")}
          </span>
          {attachedFile && (
            <button
              onClick={() => setAttachedFile(null)}
              className="rounded-2xl border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              {t("standalone.clearFile")}
            </button>
          )}
          <input
            ref={optionalFileInputRef}
            type="file"
            className="hidden"
            accept={optionalFileParam.accept?.join(",") ?? undefined}
            onChange={(e) => setAttachedFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      {phase === "done" && result && entry && (
        <entry.component {...P({ toolName: widgetKey, status: complete, result })} />
      )}

      {phase === "done" && result && !entry && (
        <FallbackResult result={result} />
      )}

      {phase === "error" && error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ── Fallback result ─────────────────────────────────────────────────────

function FallbackResult({ result }: { result: Record<string, unknown> }) {
  const t = useT();
  const fileUrl = extractUrl(result);
  return (
    <div className="space-y-2 rounded-[24px] border border-emerald-500/25 bg-emerald-500/10 p-4 text-white">
      <div className="flex items-center gap-2 text-xs text-emerald-400">
        <CheckCircle2Icon className="size-3.5" /><span>{t("standalone.done")}</span>
      </div>
      {fileUrl && <SaveButton url={fileUrl} filename={String(result.filename ?? "download")} />}
      {!fileUrl && Object.keys(result).length > 0 && (
        <pre className="max-h-40 overflow-auto rounded-[20px] bg-black/30 p-3 font-mono text-[11px] text-zinc-300">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────

export function ToolStandalone({ tool }: { tool: ToolManifest }) {
  const widgetKey = toWidgetKey(tool.id);
  const hasDefaults = widgetKey in TOOL_DEFAULTS;
  const isFileInput = tool.params.some(p => p.type === "file");
  const isIOPaintStudio = tool.id === "image.iopaint_studio";

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(120,197,249,0.1),transparent_24%),linear-gradient(180deg,rgba(4,7,10,1),rgba(7,11,16,1))]">
      <ToolHeader tool={tool} />
      {isIOPaintStudio ? (
        <IOPaintStudio tool={tool} />
      ) : hasDefaults ? (
        <WidgetMode tool={tool} widgetKey={widgetKey} />
      ) : isFileInput ? (
        <FileDropMode tool={tool} widgetKey={widgetKey} />
      ) : (
        <TextInputMode tool={tool} widgetKey={widgetKey} />
      )}
    </div>
  );
}
