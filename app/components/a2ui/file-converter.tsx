// @input: Tool result with { source_format?, target_format?, file_url? } — or standalone
// @output: VERT-style drag-drop file converter with pure-browser transforms
// @position: A2UI widget — client-side file format converter mini-app

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCwIcon, UploadIcon, DownloadIcon, CheckCircle2Icon, AlertCircleIcon, ChevronDownIcon } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import { memoWidget, unwrapResult, triggerDownload } from "./utils";
import { DarkShell } from "./dark-shell";

// ── Format definitions ──────────────────────────────────────────────────────

type FormatId = "png" | "jpg" | "webp" | "svg" | "json" | "csv" | "yaml" | "txt";

type FormatDef = { label: string; mime: string; ext: string; group: string };

const FORMATS: Record<FormatId, FormatDef> = {
  png:  { label: "PNG",  mime: "image/png",             ext: "png",  group: "Image" },
  jpg:  { label: "JPG",  mime: "image/jpeg",            ext: "jpg",  group: "Image" },
  webp: { label: "WebP", mime: "image/webp",            ext: "webp", group: "Image" },
  svg:  { label: "SVG",  mime: "image/svg+xml",         ext: "svg",  group: "Image" },
  json: { label: "JSON", mime: "application/json",      ext: "json", group: "Data"  },
  csv:  { label: "CSV",  mime: "text/csv",              ext: "csv",  group: "Data"  },
  yaml: { label: "YAML", mime: "application/x-yaml",   ext: "yaml", group: "Data"  },
  txt:  { label: "TXT",  mime: "text/plain",            ext: "txt",  group: "Text"  },
};

// Which conversions are supported
const COMPAT: Partial<Record<FormatId, FormatId[]>> = {
  png:  ["jpg", "webp"],
  jpg:  ["png", "webp"],
  webp: ["png", "jpg"],
  json: ["csv", "yaml", "txt"],
  csv:  ["json", "yaml"],
  yaml: ["json", "txt"],
  txt:  ["json"],
};

// ── Converters ───────────────────────────────────────────────────────────────

async function convertImage(file: File, toFmt: FormatId): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      if (toFmt === "jpg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Canvas toBlob failed")),
        FORMATS[toFmt].mime,
        0.92
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

function parseJson(text: string): unknown[] | Record<string, unknown> {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  return parsed as Record<string, unknown>;
}

function jsonToCsv(data: unknown): string {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as object);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(","))].join("\n");
}

function csvToJson(text: string): string {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const vals = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? ""]));
  });
  return JSON.stringify(rows, null, 2);
}

function jsonToYaml(data: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (data === null || data === undefined) return "null";
  if (typeof data === "string") return data.includes("\n") ? `|\n${pad}  ${data.replace(/\n/g, `\n${pad}  `)}` : data;
  if (typeof data !== "object") return String(data);
  if (Array.isArray(data)) return data.map((v) => `${pad}- ${jsonToYaml(v, indent + 1)}`).join("\n");
  return Object.entries(data as object).map(([k, v]) => {
    const val = typeof v === "object" && v !== null ? `\n${jsonToYaml(v, indent + 1)}` : ` ${jsonToYaml(v, indent)}`;
    return `${pad}${k}:${val}`;
  }).join("\n");
}

async function convert(file: File, from: FormatId, to: FormatId): Promise<{ blob: Blob; filename: string }> {
  const isImage = (f: FormatId) => ["png", "jpg", "webp", "svg"].includes(f);

  let blob: Blob;
  if (isImage(from) && isImage(to)) {
    blob = await convertImage(file, to);
  } else {
    const text = await file.text();
    let output = "";
    if (from === "json" && to === "csv")  output = jsonToCsv(parseJson(text));
    else if (from === "csv" && to === "json") output = csvToJson(text);
    else if (from === "json" && to === "yaml") output = jsonToYaml(parseJson(text));
    else if (from === "yaml" && to === "json") output = JSON.stringify(parseYamlSimple(text), null, 2);
    else if (from === "json" && to === "txt") output = JSON.stringify(parseJson(text), null, 2);
    else if (from === "yaml" && to === "txt") output = text;
    else if (from === "txt" && to === "json") output = JSON.stringify({ content: text }, null, 2);
    else if (from === "csv" && to === "yaml") output = jsonToYaml(JSON.parse(csvToJson(text)));
    else output = text;
    blob = new Blob([output], { type: FORMATS[to].mime });
  }

  const basename = file.name.replace(/\.[^.]+$/, "");
  return { blob, filename: `${basename}.${FORMATS[to].ext}` };
}

// Minimal YAML-to-object parser (handles simple flat/list structures)
function parseYamlSimple(text: string): unknown {
  const lines = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines[0]?.trimStart().startsWith("-")) {
    return lines.filter((l) => l.trim().startsWith("-")).map((l) => l.replace(/^-\s*/, "").trim());
  }
  const obj: Record<string, string> = {};
  for (const line of lines) {
    const [k, ...vs] = line.split(":");
    if (k && vs.length) obj[k.trim()] = vs.join(":").trim();
  }
  return obj;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectFormat(file: File): FormatId | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return (ext && ext in FORMATS) ? (ext as FormatId) : null;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FormatSelect({
  value, onChange, disabled, label,
}: {
  value: FormatId | null;
  onChange: (v: FormatId) => void;
  disabled?: boolean;
  label: string;
}) {
  const groups = Object.entries(FORMATS).reduce<Record<string, [FormatId, FormatDef][]>>((acc, [id, def]) => {
    (acc[def.group] ??= []).push([id as FormatId, def]);
    return acc;
  }, {});

  return (
    <div className="relative flex-1">
      <label className="block text-[9px] text-zinc-500 mb-0.5">{label}</label>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value as FormatId)}
          disabled={disabled}
          className={cn(
            "w-full appearance-none rounded-md bg-zinc-800 px-2 py-1.5 pr-6 text-[11px] text-zinc-200 outline-none focus-visible:ring-1 focus-visible:ring-white/30 transition cursor-pointer",
            disabled && "opacity-40 cursor-not-allowed"
          )}
        >
          <option value="" disabled>Select…</option>
          {Object.entries(groups).map(([group, fmts]) => (
            <optgroup key={group} label={group}>
              {fmts.map(([id, def]) => (
                <option key={id} value={id}>{def.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 size-3 text-zinc-500" />
      </div>
    </div>
  );
}

type Status = "idle" | "converting" | "done" | "error";

// ── Main widget ──────────────────────────────────────────────────────────────

const FileConverterImpl: ToolCallMessagePartComponent = ({ result, status }) => {
  const [fromFmt, setFromFmt] = useState<FormatId | null>(null);
  const [toFmt, setToFmt] = useState<FormatId | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [convStatus, setConvStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-fill from tool result
  useEffect(() => {
    if (status.type !== "complete") return;
    const json = unwrapResult(result);
    if (json.source_format && String(json.source_format) in FORMATS)
      setFromFmt(json.source_format as FormatId);
    if (json.target_format && String(json.target_format) in FORMATS)
      setToFmt(json.target_format as FormatId);
  }, [result, status.type]);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setConvStatus("idle");
    setErrorMsg("");
    const detected = detectFormat(f);
    if (detected) setFromFmt(detected);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleConvert = useCallback(async () => {
    if (!file || !fromFmt || !toFmt) return;
    setConvStatus("converting");
    setProgress(0);

    // Animate progress bar
    const tick = setInterval(() => setProgress((p) => Math.min(p + 12, 85)), 120);
    try {
      const { blob, filename } = await convert(file, fromFmt, toFmt);
      clearInterval(tick);
      setProgress(100);
      setConvStatus("done");
      const url = URL.createObjectURL(blob);
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      clearInterval(tick);
      setConvStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Conversion failed");
    }
  }, [file, fromFmt, toFmt]);

  const reset = useCallback(() => {
    setFile(null);
    setConvStatus("idle");
    setProgress(0);
    setErrorMsg("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const targetOptions = fromFmt ? (COMPAT[fromFmt] ?? []) : [];
  const canConvert = !!file && !!fromFmt && !!toFmt && convStatus !== "converting";

  const skeleton = (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <RefreshCwIcon className="size-3.5 animate-pulse text-orange-400" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mt-3 h-20 animate-pulse rounded-lg bg-zinc-800" />
    </div>
  );

  return (
    <DarkShell status={status} maxWidth="md" skeleton={skeleton} title="File Converter">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <RefreshCwIcon className="size-3 text-orange-400" />
        <span className="text-[11px] font-medium text-zinc-300">File Converter</span>
        <span className="ml-auto text-[10px] text-zinc-600">Browser-only · No upload</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a file or click to choose"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-5 transition-colors cursor-pointer select-none",
            dragging ? "border-orange-400/60 bg-orange-500/5" : "border-white/10 hover:border-white/20"
          )}
        >
          <input ref={inputRef} type="file" className="hidden" onChange={onInputChange} />
          {file ? (
            <>
              <CheckCircle2Icon className="size-5 text-emerald-400" />
              <p className="text-[11px] text-zinc-300 font-medium truncate max-w-[180px]">{file.name}</p>
              <p className="text-[10px] text-zinc-600">{(file.size / 1024).toFixed(1)} KB</p>
            </>
          ) : (
            <>
              <UploadIcon className={cn("size-5 transition-colors", dragging ? "text-orange-400" : "text-zinc-600")} />
              <p className="text-[11px] text-zinc-400">Drop a file here</p>
              <p className="text-[10px] text-zinc-600">or click to browse</p>
            </>
          )}
        </div>

        {/* Format selectors */}
        <div className="flex items-end gap-2">
          <FormatSelect value={fromFmt} onChange={(v) => { setFromFmt(v); setToFmt(null); }} label="From" />
          <div className="flex items-center justify-center pb-1.5">
            <RefreshCwIcon className="size-3.5 text-zinc-600" />
          </div>
          <FormatSelect
            value={toFmt}
            onChange={setToFmt}
            label="To"
            disabled={!fromFmt || targetOptions.length === 0}
          />
        </div>

        {/* No compat warning */}
        {fromFmt && targetOptions.length === 0 && (
          <p className="text-[10px] text-amber-400/80 flex items-center gap-1">
            <AlertCircleIcon className="size-3 shrink-0" />
            No conversions available for this format
          </p>
        )}

        {/* Progress bar */}
        {convStatus === "converting" && (
          <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-orange-400 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Error */}
        {convStatus === "error" && (
          <p className="text-[10px] text-red-400 flex items-center gap-1">
            <AlertCircleIcon className="size-3 shrink-0" />
            {errorMsg}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleConvert}
            disabled={!canConvert}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
              canConvert
                ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            )}
          >
            {convStatus === "converting" ? (
              <>
                <RefreshCwIcon className="size-3 animate-spin" />
                Converting…
              </>
            ) : convStatus === "done" ? (
              <>
                <DownloadIcon className="size-3" />
                Downloaded
              </>
            ) : (
              <>
                <RefreshCwIcon className="size-3" />
                Convert &amp; Download
              </>
            )}
          </button>

          {(file || convStatus !== "idle") && (
            <button
              onClick={reset}
              className="rounded-md px-2 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </DarkShell>
  );
};

export const FileConverter = memoWidget(FileConverterImpl);
