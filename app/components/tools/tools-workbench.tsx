"use client";

import {
  AlertTriangleIcon,
  Clock3Icon,
  ExternalLinkIcon,
  HistoryIcon,
  InfoIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  SearchIcon,
  ShieldIcon,
  SparklesIcon,
  UploadIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRunStatus } from "@/hooks/use-run-status";
import {
  getBillingSummary,
  executeToolAsync,
  executeToolSync,
  getToolDetail,
  getToolJob,
  listBillingUsage,
  listToolSummaries,
  type BillingSummary,
  type BillingUsageRecord,
  type ToolDetail,
  type ToolJobResponse,
  type ToolSummary,
  type ToolUploadedFile,
  uploadToolInputFiles,
} from "@/lib/api/tooling";

type ToolInputSpec = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  minimum?: number;
  maximum?: number;
  accepts: string[];
};

type ValidationIssue = {
  field: string;
  message: string;
};

type OutputLink = {
  label: string;
  url: string;
};

type HistoryStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

type ExecutionMode = "sync" | "async";

type HistoryEntry = {
  apiKeyId?: string;
  createdAt: number;
  creditsUsed?: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  jobId?: string;
  mode: ExecutionMode;
  origin: "session" | "billing";
  paramsSnapshot?: Record<string, unknown>;
  runId: string;
  source?: string;
  spawnDepth?: number;
  spawnedBy?: string;
  status: HistoryStatus;
  tenantId?: string;
  tool: string;
};

type ConsolePane = "result" | "job" | "timeline" | "history";

const TERMINAL_JOB_STATUS = new Set<ToolJobResponse["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

const RUN_STATUS_STYLES: Record<string, string> = {
  accepted: "border-amber-300 bg-amber-100 text-amber-900",
  running: "border-blue-300 bg-blue-100 text-blue-900",
  succeeded: "border-emerald-300 bg-emerald-100 text-emerald-900",
  failed: "border-rose-300 bg-rose-100 text-rose-900",
  cancelled: "border-zinc-300 bg-zinc-200 text-zinc-900",
};

const CONNECTION_STYLES: Record<string, string> = {
  idle: "border-zinc-300 bg-zinc-100 text-zinc-700",
  connecting: "border-amber-300 bg-amber-100 text-amber-900",
  live: "border-emerald-300 bg-emerald-100 text-emerald-900",
  reconnecting: "border-orange-300 bg-orange-100 text-orange-900",
  offline: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
  accepted: "queued",
  running: "running",
  succeeded: "success",
  failed: "failed",
  cancelled: "cancelled",
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isUrl = (value: string): boolean => {
  return /^https?:\/\/\S+$/i.test(value.trim());
};

const isLinkTarget = (value: string): boolean => {
  const trimmed = value.trim();
  return isUrl(trimmed) || trimmed.startsWith("/");
};

const isMultiFileSpec = (spec: ToolInputSpec): boolean => {
  return spec.type === "file[]" || spec.name.endsWith("_urls");
};

const normalizeInputs = (tool?: ToolDetail): ToolInputSpec[] => {
  const rawInputs = Array.isArray(tool?.manifest?.io?.inputs)
    ? tool?.manifest?.io?.inputs
    : Array.isArray(tool?.manifest?.params)
      ? tool?.manifest?.params
      : [];

  if (rawInputs.length === 0) {
    return [];
  }

  const specs: ToolInputSpec[] = [];
  for (const raw of rawInputs) {
    if (!isObject(raw)) continue;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) continue;
    const accepts = Array.isArray(raw.accepts)
      ? raw.accepts.filter((item): item is string => typeof item === "string")
      : Array.isArray(raw.accept)
        ? raw.accept.filter((item): item is string => typeof item === "string")
      : [];
    specs.push({
      name,
      type: typeof raw.type === "string" ? raw.type : "string",
      required: raw.required === true,
      defaultValue: raw.default,
      minimum:
        typeof raw.minimum === "number" && Number.isFinite(raw.minimum)
          ? raw.minimum
          : typeof raw.min === "number" && Number.isFinite(raw.min)
            ? raw.min
          : undefined,
      maximum:
        typeof raw.maximum === "number" && Number.isFinite(raw.maximum)
          ? raw.maximum
          : typeof raw.max === "number" && Number.isFinite(raw.max)
            ? raw.max
          : undefined,
      accepts,
    });
  }
  return specs;
};

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
};

const parseFileEntries = (value: string): string[] => {
  return value
    .split(/[\r\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const buildInitialValues = (specs: ToolInputSpec[]): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const spec of specs) {
    if (spec.defaultValue === undefined || spec.defaultValue === null) {
      next[spec.name] = "";
      continue;
    }
    if (typeof spec.defaultValue === "string") {
      next[spec.name] = spec.defaultValue;
      continue;
    }
    if (typeof spec.defaultValue === "number") {
      next[spec.name] = String(spec.defaultValue);
      continue;
    }
    next[spec.name] = formatJson(spec.defaultValue);
  }
  return next;
};

const validateInputValues = (
  specs: ToolInputSpec[],
  values: Record<string, string>,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const spec of specs) {
    const raw = values[spec.name] ?? "";
    const trimmed = raw.trim();

    if (spec.required) {
      if (isMultiFileSpec(spec)) {
        if (parseFileEntries(raw).length === 0) {
          issues.push({
            field: spec.name,
            message: "At least one file URL is required.",
          });
          continue;
        }
      } else if (!trimmed) {
        issues.push({
          field: spec.name,
          message: "This field is required.",
        });
        continue;
      }
    }

    if (!trimmed) {
      continue;
    }

    if (spec.type === "number") {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        issues.push({
          field: spec.name,
          message: "Must be a valid number.",
        });
        continue;
      }
      if (typeof spec.minimum === "number" && parsed < spec.minimum) {
        issues.push({
          field: spec.name,
          message: `Must be >= ${spec.minimum}.`,
        });
        continue;
      }
      if (typeof spec.maximum === "number" && parsed > spec.maximum) {
        issues.push({
          field: spec.name,
          message: `Must be <= ${spec.maximum}.`,
        });
      }
    }
  }
  return issues;
};

const toExecutionParams = (
  specs: ToolInputSpec[],
  values: Record<string, string>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const spec of specs) {
    const raw = values[spec.name] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (spec.type === "number") {
      result[spec.name] = Number(trimmed);
      continue;
    }

    if (isMultiFileSpec(spec)) {
      const entries = parseFileEntries(raw);
      if (entries.length > 0) {
        result[spec.name] = entries;
      }
      continue;
    }

    result[spec.name] = trimmed;
  }

  return result;
};

const toPercentLabel = (value?: number): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
};

const renderInputHint = (spec: ToolInputSpec): string => {
  const tags: string[] = [];
  tags.push(spec.required ? "required" : "optional");
  if (spec.accepts.length > 0) {
    tags.push(`accept: ${spec.accepts.join(", ")}`);
  }
  if (typeof spec.minimum === "number" || typeof spec.maximum === "number") {
    tags.push(`range: ${spec.minimum ?? "-inf"}..${spec.maximum ?? "+inf"}`);
  }
  return tags.join(" | ");
};

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
};

const formatTimestamp = (value?: string): string => {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "-";
  return new Date(timestamp).toLocaleString();
};

const normalizeOutputLinks = (value: unknown): OutputLink[] => {
  if (!isObject(value)) return [];

  const links: OutputLink[] = [];
  const seen = new Set<string>();
  const push = (label: string, raw: unknown) => {
    if (typeof raw !== "string") return;
    const url = raw.trim();
    if (!url || !isLinkTarget(url) || seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  };

  push("Output file", value.output_file_url);
  push("Output archive", value.output_archive_url);

  for (const [key, raw] of Object.entries(value)) {
    if (
      (key.endsWith("_url") || key.endsWith("Url")) &&
      key !== "output_file_url" &&
      key !== "output_archive_url"
    ) {
      push(key, raw);
    }
  }

  return links;
};

const toHistoryStatusFromJob = (
  status: ToolJobResponse["status"],
): HistoryStatus => {
  if (status === "queued") return "accepted";
  if (status === "processing") return "running";
  if (status === "completed") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "failed";
};

const toHistoryStatusFromBilling = (
  status: BillingUsageRecord["status"],
): HistoryStatus => {
  if (status === "succeeded") return "succeeded";
  if (status === "cancelled") return "cancelled";
  return "failed";
};

const toHistoryFromBilling = (record: BillingUsageRecord): HistoryEntry => {
  return {
    apiKeyId: record.apiKeyId,
    createdAt: record.createdAt,
    creditsUsed: record.creditsUsed,
    durationMs: record.durationMs,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    jobId: record.jobId,
    mode: record.jobId ? "async" : "sync",
    origin: "billing",
    runId: record.runId,
    source: record.source,
    status: toHistoryStatusFromBilling(record.status),
    tenantId: record.tenantId,
    tool: record.tool,
  };
};

const buildHistoryKey = (entry: { jobId?: string; runId: string }): string => {
  return entry.jobId ? `${entry.runId}:${entry.jobId}` : entry.runId;
};

const mergeHistory = (
  billing: readonly BillingUsageRecord[],
  session: readonly HistoryEntry[],
): HistoryEntry[] => {
  const merged = new Map<string, HistoryEntry>();

  for (const record of billing) {
    const entry = toHistoryFromBilling(record);
    merged.set(buildHistoryKey(entry), entry);
  }

  for (const entry of session) {
    const key = buildHistoryKey(entry);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      continue;
    }

    merged.set(key, {
      ...existing,
      ...entry,
      paramsSnapshot: entry.paramsSnapshot ?? existing.paramsSnapshot,
      origin: entry.origin,
    });
  }

  return [...merged.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80);
};

const getUploadExpiration = (file: ToolUploadedFile): number | undefined => {
  const raw = file.artifact?.expires_at;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  return raw;
};

const isUploadExpired = (file: ToolUploadedFile, now = Date.now()): boolean => {
  const expiresAt = getUploadExpiration(file);
  if (expiresAt === undefined) {
    return false;
  }
  return expiresAt <= now;
};

const findExpiredInputFields = (
  specs: readonly ToolInputSpec[],
  values: Record<string, string>,
  uploads: Record<string, ToolUploadedFile[]>,
): string[] => {
  const expiredFields = new Set<string>();
  for (const spec of specs) {
    if (spec.type !== "file" && !isMultiFileSpec(spec)) {
      continue;
    }
    const fieldUploads = uploads[spec.name] ?? [];
    if (fieldUploads.length === 0) continue;

    const configuredUrls = new Set(parseFileEntries(values[spec.name] ?? ""));
    for (const upload of fieldUploads) {
      if (!isUploadExpired(upload)) continue;
      const candidates = [upload.executor_url, upload.url].filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      );
      if (
        candidates.some((candidate) => configuredUrls.has(candidate.trim()))
      ) {
        expiredFields.add(spec.name);
      }
    }
  }

  return [...expiredFields];
};

const formatAge = (timestampMs: number): string => {
  const delta = Date.now() - timestampMs;
  if (!Number.isFinite(delta) || delta < 60_000) {
    return "just now";
  }
  if (delta < 60 * 60_000) {
    return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
  }
  if (delta < 24 * 60 * 60_000) {
    return `${Math.max(1, Math.floor(delta / (60 * 60_000)))}h ago`;
  }
  return `${Math.max(1, Math.floor(delta / (24 * 60 * 60_000)))}d ago`;
};

const formatExpiry = (timestampMs: number | undefined): string => {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) {
    return "no expiry";
  }

  const delta = timestampMs - Date.now();
  if (delta <= 0) {
    return "expired";
  }
  if (delta < 60 * 60_000) {
    return `expires in ${Math.max(1, Math.floor(delta / 60_000))}m`;
  }
  if (delta < 24 * 60 * 60_000) {
    return `expires in ${Math.max(1, Math.floor(delta / (60 * 60_000)))}h`;
  }
  return `expires ${new Date(timestampMs).toLocaleString()}`;
};

const toInputValuesFromParams = (
  specs: readonly ToolInputSpec[],
  params: Record<string, unknown>,
): Record<string, string> => {
  const next = buildInitialValues([...specs]);
  for (const spec of specs) {
    const raw = params[spec.name];
    if (raw === undefined || raw === null) continue;

    if (isMultiFileSpec(spec) && Array.isArray(raw)) {
      const values = raw
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
      next[spec.name] = values.join("\n");
      continue;
    }

    if (typeof raw === "string" || typeof raw === "number") {
      next[spec.name] = String(raw);
      continue;
    }

    next[spec.name] = formatJson(raw);
  }

  return next;
};

export function ToolsWorkbench() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedToolId, setSelectedToolId] = useState<string>("");
  const [selectedTool, setSelectedTool] = useState<ToolDetail | undefined>(
    undefined,
  );
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [fieldUploads, setFieldUploads] = useState<
    Record<string, ToolUploadedFile[]>
  >({});
  const [pendingInputRestore, setPendingInputRestore] = useState<
    { toolId: string; params: Record<string, unknown> } | undefined
  >(undefined);
  const [uploadingField, setUploadingField] = useState<string | undefined>(
    undefined,
  );
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyMode, setBusyMode] = useState<"sync" | "async" | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [billingError, setBillingError] = useState<string | undefined>(
    undefined,
  );
  const [historyError, setHistoryError] = useState<string | undefined>(
    undefined,
  );
  const [syncResult, setSyncResult] = useState<Record<string, unknown>>();
  const [lastSyncRunId, setLastSyncRunId] = useState<string | undefined>(
    undefined,
  );
  const [activeJobId, setActiveJobId] = useState<string | undefined>(undefined);
  const [jobState, setJobState] = useState<ToolJobResponse | undefined>(
    undefined,
  );
  const [sessionHistory, setSessionHistory] = useState<HistoryEntry[]>([]);
  const [billingUsage, setBillingUsage] = useState<BillingUsageRecord[]>([]);
  const [billingSummary, setBillingSummary] = useState<BillingSummary>();
  const [billingLoading, setBillingLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [consolePane, setConsolePane] = useState<ConsolePane>("result");

  const filteredTools = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    if (!lowered) return tools;
    return tools.filter((tool) => {
      return [tool.id, tool.name, tool.description, tool.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(lowered);
    });
  }, [query, tools]);

  useEffect(() => {
    const lowered = query.trim();
    if (!lowered || filteredTools.length === 0) {
      return;
    }
    if (filteredTools.some((tool) => tool.id === selectedToolId)) {
      return;
    }
    setSelectedToolId(filteredTools[0].id);
  }, [filteredTools, query, selectedToolId]);

  const inputSpecs = useMemo(
    () => normalizeInputs(selectedTool),
    [selectedTool],
  );

  const activeRunId = useMemo(() => {
    if (jobState?.run_id?.trim()) {
      return jobState.run_id.trim();
    }
    return lastSyncRunId;
  }, [jobState?.run_id, lastSyncRunId]);

  const {
    run: trackedRun,
    connection: runConnection,
    events: runEvents,
  } = useRunStatus(activeRunId, 1200);

  const syncOutputLinks = useMemo(
    () => normalizeOutputLinks(syncResult),
    [syncResult],
  );
  const asyncOutputLinks = useMemo(
    () => normalizeOutputLinks(jobState?.result),
    [jobState?.result],
  );

  const expiredInputFields = useMemo(
    () => findExpiredInputFields(inputSpecs, inputValues, fieldUploads),
    [fieldUploads, inputSpecs, inputValues],
  );

  const combinedHistory = useMemo(
    () => mergeHistory(billingUsage, sessionHistory),
    [billingUsage, sessionHistory],
  );

  const activeAuditContext = useMemo(() => {
    const activeEntry = activeRunId
      ? combinedHistory.find((entry) => entry.runId === activeRunId)
      : undefined;
    const fallbackEntry = activeEntry ?? combinedHistory[0];
    const resolvedSpawnDepth =
      typeof trackedRun?.spawnDepth === "number" &&
      Number.isFinite(trackedRun.spawnDepth)
        ? trackedRun.spawnDepth
        : fallbackEntry?.spawnDepth;
    return {
      apiKeyId: trackedRun?.apiKeyId ?? fallbackEntry?.apiKeyId,
      source: trackedRun?.source ?? fallbackEntry?.source,
      spawnDepth: resolvedSpawnDepth,
      spawnedBy: trackedRun?.spawnedBy ?? fallbackEntry?.spawnedBy,
      tenantId:
        trackedRun?.tenantId ??
        fallbackEntry?.tenantId ??
        billingSummary?.tenantId,
    };
  }, [activeRunId, billingSummary?.tenantId, combinedHistory, trackedRun]);

  const upsertSessionEntry = useCallback((incoming: HistoryEntry) => {
    setSessionHistory((current) => {
      const key = buildHistoryKey(incoming);
      const next = new Map<string, HistoryEntry>(
        current.map((entry) => [buildHistoryKey(entry), entry]),
      );
      const existing = next.get(key);

      next.set(key, {
        ...existing,
        ...incoming,
        createdAt: existing?.createdAt ?? incoming.createdAt,
        mode: existing?.mode ?? incoming.mode,
        origin: "session",
        paramsSnapshot: incoming.paramsSnapshot ?? existing?.paramsSnapshot,
      });

      return [...next.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 80);
    });
  }, []);

  const refreshBillingData = useCallback(
    async (reason: "init" | "manual" | "post-run" = "manual") => {
      const initialLoad = reason === "init";
      if (initialLoad) {
        setBillingLoading(true);
        setHistoryLoading(true);
      }
      if (reason === "manual") {
        setHistoryRefreshing(true);
      }

      setBillingError(undefined);
      setHistoryError(undefined);

      try {
        const [summaryResult, usageResult] = await Promise.allSettled([
          getBillingSummary(),
          listBillingUsage(80),
        ]);

        if (summaryResult.status === "fulfilled") {
          setBillingSummary(summaryResult.value);
        } else {
          setBillingError(
            summaryResult.reason instanceof Error
              ? summaryResult.reason.message
              : "Failed to load billing summary",
          );
        }

        if (usageResult.status === "fulfilled") {
          setBillingUsage(usageResult.value);
        } else {
          setHistoryError(
            usageResult.reason instanceof Error
              ? usageResult.reason.message
              : "Failed to load execution history",
          );
        }
      } finally {
        if (initialLoad) {
          setBillingLoading(false);
          setHistoryLoading(false);
        }
        if (reason === "manual") {
          setHistoryRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    const load = async () => {
      setCatalogLoading(true);
      setError(undefined);
      try {
        const items = await listToolSummaries();
        if (!active) return;
        setTools(items);

        const requestedFromQuery =
          typeof window !== "undefined"
            ? new URL(window.location.href).searchParams.get("tool")?.trim()
            : undefined;

        setSelectedToolId((current) => {
          if (current) return current;
          if (
            requestedFromQuery &&
            items.some((item) => item.id === requestedFromQuery)
          ) {
            return requestedFromQuery;
          }
          return items[0]?.id ?? current;
        });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load tools");
      } finally {
        if (active) {
          setCatalogLoading(false);
        }
      }
    };

    void load();
    void refreshBillingData("init");

    return () => {
      active = false;
    };
  }, [refreshBillingData]);

  useEffect(() => {
    if (!selectedToolId) {
      setSelectedTool(undefined);
      setInputValues({});
      setFieldUploads({});
      setSyncResult(undefined);
      setLastSyncRunId(undefined);
      setActiveJobId(undefined);
      setJobState(undefined);
      setConsolePane("result");
      return;
    }

    let active = true;
    const loadDetail = async () => {
      setDetailLoading(true);
      setError(undefined);
      setSyncResult(undefined);
      setLastSyncRunId(undefined);
      setActiveJobId(undefined);
      setJobState(undefined);
      setConsolePane("result");
      try {
        const detail = await getToolDetail(selectedToolId);
        if (!active) return;
        setSelectedTool(detail);
        setInputValues(buildInitialValues(normalizeInputs(detail)));
        setFieldUploads({});
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load tool detail",
        );
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      active = false;
    };
  }, [selectedToolId]);

  useEffect(() => {
    if (!pendingInputRestore || !selectedTool) {
      return;
    }
    if (pendingInputRestore.toolId !== selectedTool.id) {
      return;
    }
    const specs = normalizeInputs(selectedTool);
    setInputValues(toInputValuesFromParams(specs, pendingInputRestore.params));
    setPendingInputRestore(undefined);
  }, [pendingInputRestore, selectedTool]);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const nextJob = await getToolJob(activeJobId);
        if (cancelled) return;
        setJobState(nextJob);

        upsertSessionEntry({
          createdAt:
            typeof nextJob.started_at === "number" &&
            Number.isFinite(nextJob.started_at)
              ? nextJob.started_at
              : Date.now(),
          durationMs:
            typeof nextJob.duration_ms === "number" &&
            Number.isFinite(nextJob.duration_ms)
              ? Math.max(1, Math.floor(nextJob.duration_ms))
              : undefined,
          errorCode: nextJob.error?.code,
          errorMessage: nextJob.error?.message,
          jobId: nextJob.job_id,
          mode: "async",
          origin: "session",
          runId: nextJob.run_id,
          status: toHistoryStatusFromJob(nextJob.status),
          tool: nextJob.tool,
        });

        if (!TERMINAL_JOB_STATUS.has(nextJob.status)) {
          timer = setTimeout(() => {
            void tick();
          }, 850);
          return;
        }

        if (nextJob.status === "failed" && nextJob.error) {
          setError(`${nextJob.error.code}: ${nextJob.error.message}`);
        }
        setBusyMode((current) => (current === "async" ? null : current));
        setActiveJobId(undefined);
        void refreshBillingData("post-run");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch job");
        setBusyMode((current) => (current === "async" ? null : current));
        setActiveJobId(undefined);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [activeJobId, refreshBillingData, upsertSessionEntry]);

  useEffect(() => {
    if (!trackedRun) {
      return;
    }

    const acceptedAtMs = trackedRun.acceptedAt
      ? Date.parse(trackedRun.acceptedAt)
      : Number.NaN;
    const startedAtMs = trackedRun.startedAt
      ? Date.parse(trackedRun.startedAt)
      : Number.NaN;
    const endedAtMs = trackedRun.endedAt
      ? Date.parse(trackedRun.endedAt)
      : Number.NaN;
    const durationMs =
      Number.isFinite(startedAtMs) &&
      Number.isFinite(endedAtMs) &&
      endedAtMs >= startedAtMs
        ? endedAtMs - startedAtMs
        : undefined;

    setSessionHistory((current) =>
      current.map((entry) => {
        if (entry.runId !== trackedRun.runId) {
          return entry;
        }
        return {
          ...entry,
          apiKeyId: trackedRun.apiKeyId ?? entry.apiKeyId,
          createdAt:
            typeof acceptedAtMs === "number" && Number.isFinite(acceptedAtMs)
              ? acceptedAtMs
              : entry.createdAt,
          durationMs: durationMs ?? entry.durationMs,
          errorMessage: trackedRun.error ?? entry.errorMessage,
          source: trackedRun.source ?? entry.source,
          spawnDepth:
            typeof trackedRun.spawnDepth === "number" &&
            Number.isFinite(trackedRun.spawnDepth)
              ? Math.max(0, Math.floor(trackedRun.spawnDepth))
              : entry.spawnDepth,
          spawnedBy: trackedRun.spawnedBy ?? entry.spawnedBy,
          status: trackedRun.status,
          tenantId: trackedRun.tenantId ?? entry.tenantId,
        };
      }),
    );
  }, [trackedRun]);

  const onChangeField = (name: string, value: string) => {
    setInputValues((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const onUpload = async (spec: ToolInputSpec, files: FileList | null) => {
    if (!selectedToolId || !files || files.length === 0) {
      return;
    }

    const picked = Array.from(files);
    setUploadingField(spec.name);
    setError(undefined);

    try {
      const uploaded = await uploadToolInputFiles(picked, selectedToolId);
      if (uploaded.length === 0) {
        throw new Error("Upload did not return file URL.");
      }

      setFieldUploads((current) => {
        const previous = current[spec.name] ?? [];
        const next =
          isMultiFileSpec(spec)
            ? [...previous, ...uploaded]
            : uploaded.slice(0, 1);
        return {
          ...current,
          [spec.name]: next,
        };
      });

      if (isMultiFileSpec(spec)) {
        setInputValues((current) => {
          const previous = parseFileEntries(current[spec.name] ?? "");
          const merged = [
            ...previous,
            ...uploaded.map((item) => item.executor_url ?? item.url),
          ];
          const deduped = Array.from(new Set(merged));
          return {
            ...current,
            [spec.name]: deduped.join("\n"),
          };
        });
      } else {
        setInputValues((current) => ({
          ...current,
          [spec.name]: uploaded[0].executor_url ?? uploaded[0].url,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed");
    } finally {
      setUploadingField(undefined);
    }
  };

  const executeSyncRun = useCallback(
    async (
      toolId: string,
      params: Record<string, unknown>,
      paramsSnapshot: Record<string, unknown>,
    ) => {
      setBusyMode("sync");
      setConsolePane("result");
      setError(undefined);
      setSyncResult(undefined);
      setLastSyncRunId(undefined);

      const createdAt = Date.now();
      try {
        const response = await executeToolSync(toolId, params);
        if (response.status === "failed") {
          setError(`${response.error.code}: ${response.error.message}`);
          setLastSyncRunId(response.run_id);
          upsertSessionEntry({
            createdAt,
            errorCode: response.error.code,
            errorMessage: response.error.message,
            mode: "sync",
            origin: "session",
            paramsSnapshot,
            runId: response.run_id,
            status: "failed",
            tool: toolId,
          });
          return;
        }

        setSyncResult(response.result);
        setLastSyncRunId(response.run_id);
        upsertSessionEntry({
          createdAt,
          creditsUsed: response.credits_used,
          durationMs:
            typeof response.duration_ms === "number" &&
            Number.isFinite(response.duration_ms)
              ? Math.max(1, Math.floor(response.duration_ms))
              : undefined,
          mode: "sync",
          origin: "session",
          paramsSnapshot,
          runId: response.run_id,
          status: "succeeded",
          tool: toolId,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sync execution failed");
      } finally {
        setBusyMode(null);
        void refreshBillingData("post-run");
      }
    },
    [refreshBillingData, upsertSessionEntry],
  );

  const executeAsyncRun = useCallback(
    async (
      toolId: string,
      params: Record<string, unknown>,
      paramsSnapshot: Record<string, unknown>,
    ) => {
      setBusyMode("async");
      setConsolePane("job");
      setError(undefined);
      setJobState(undefined);

      const createdAt = Date.now();
      try {
        const enqueued = await executeToolAsync(toolId, params);
        setActiveJobId(enqueued.job_id);
        setJobState({
          job_id: enqueued.job_id,
          run_id: enqueued.run_id,
          status: enqueued.status,
          tool: toolId,
          progress: 0,
        });
        upsertSessionEntry({
          createdAt,
          jobId: enqueued.job_id,
          mode: "async",
          origin: "session",
          paramsSnapshot,
          runId: enqueued.run_id,
          status: toHistoryStatusFromJob(enqueued.status),
          tool: toolId,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Async execution failed");
        setBusyMode(null);
      }
    },
    [upsertSessionEntry],
  );

  const onRunSync = async () => {
    if (!selectedToolId) return;

    const issues = validateInputValues(inputSpecs, inputValues);
    if (issues.length > 0) {
      const summary = issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join(" | ");
      setError(`Input validation failed: ${summary}`);
      return;
    }

    if (expiredInputFields.length > 0) {
      setError(
        `Expired upload URL detected: ${expiredInputFields.join(", ")}. Re-upload files before running.`,
      );
      return;
    }

    const params = toExecutionParams(inputSpecs, inputValues);
    await executeSyncRun(selectedToolId, params, params);
  };

  const onRunAsync = async () => {
    if (!selectedToolId) return;

    const issues = validateInputValues(inputSpecs, inputValues);
    if (issues.length > 0) {
      const summary = issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join(" | ");
      setError(`Input validation failed: ${summary}`);
      return;
    }

    if (expiredInputFields.length > 0) {
      setError(
        `Expired upload URL detected: ${expiredInputFields.join(", ")}. Re-upload files before running.`,
      );
      return;
    }

    const params = toExecutionParams(inputSpecs, inputValues);
    await executeAsyncRun(selectedToolId, params, params);
  };

  const onReuseParams = (entry: HistoryEntry) => {
    if (!entry.paramsSnapshot) {
      setError(
        "This record has no parameter snapshot yet (likely imported from billing ledger).",
      );
      return;
    }

    setError(undefined);
    setSelectedToolId(entry.tool);

    if (selectedTool && selectedTool.id === entry.tool) {
      setInputValues(toInputValuesFromParams(inputSpecs, entry.paramsSnapshot));
      return;
    }

    setPendingInputRestore({
      toolId: entry.tool,
      params: entry.paramsSnapshot,
    });
  };

  const onQuickRerun = (entry: HistoryEntry) => {
    if (busyMode !== null) {
      return;
    }
    if (!entry.paramsSnapshot) {
      setError(
        "Quick rerun requires input snapshot. This record only has billing metadata.",
      );
      return;
    }

    onReuseParams(entry);
    if (entry.mode === "async") {
      setConsolePane("job");
      void executeAsyncRun(
        entry.tool,
        entry.paramsSnapshot,
        entry.paramsSnapshot,
      );
      return;
    }
    setConsolePane("result");
    void executeSyncRun(entry.tool, entry.paramsSnapshot, entry.paramsSnapshot);
  };

  return (
    <section className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <div className="rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.14),transparent_28%),linear-gradient(180deg,rgba(5,8,12,0.98),rgba(7,11,16,0.97))] px-5 py-5 text-white shadow-[0_24px_90px_rgba(0,0,0,0.34)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-sky-100/72">
              <SparklesIcon className="size-3.5" />
              Stack
            </div>
            <h1 className="mt-3 font-semibold text-[28px] leading-tight tracking-[-0.03em]">
              One surface for every tool run.
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-white/64">
              Search, upload, execute, and inspect without leaving the stack.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] text-white/72">
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
              tools <span className="font-mono text-white">{tools.length}</span>
            </div>
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
              today{" "}
              <span className="font-mono text-white">
                {billingLoading ? "-" : billingSummary?.day.totalRuns ?? 0}
              </span>
            </div>
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
              credits{" "}
              <span className="font-mono text-white">
                {billingLoading
                  ? "-"
                  : (billingSummary?.day.totalCredits ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
              tenant{" "}
              <span className="font-mono text-white">
                {activeAuditContext.tenantId ?? "local-dev"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {billingError ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-sm">
          <p className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4" />
            {billingError}
          </p>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.96))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-white/42">
                Catalog
              </p>
              <p className="mt-1 text-sm text-white/64">
                {catalogLoading ? "Loading tools..." : `${filteredTools.length} active matches`}
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] text-white/56">
              {tools.length}
            </div>
          </div>

          <div className="relative mt-3">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/34" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search a tool or action"
              className="h-11 rounded-2xl border-white/10 bg-white/6 pl-9 text-white placeholder:text-white/32"
            />
          </div>

          <div className="mt-3 space-y-2 overflow-y-auto pb-1">
            {catalogLoading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`tool-skeleton-${index}`}
                  className="rounded-[22px] border border-white/8 bg-white/5 px-3 py-3"
                >
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="mt-2 h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </div>
              ))
            ) : filteredTools.length === 0 ? (
              <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/50">
                No tool matched current query.
              </div>
            ) : (
              filteredTools.map((tool) => {
                const selected = selectedToolId === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => {
                      setSelectedToolId(tool.id);
                    }}
                    className={`w-full rounded-[24px] border px-3 py-3 text-left transition-[transform,border-color,background-color,box-shadow] ${
                      selected
                        ? "border-sky-300/35 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.16),transparent_48%),linear-gradient(180deg,rgba(18,27,37,0.96),rgba(8,12,18,0.96))] text-white shadow-[0_12px_28px_rgba(14,165,233,0.12)]"
                        : "border-white/8 bg-white/4 text-white/88 hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/7"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[11px] text-white/38">
                          {tool.id}
                        </p>
                        <p className="mt-1 truncate text-sm font-medium">{tool.name}</p>
                        <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-white/52">
                          {tool.description}
                        </p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/40">
                        {tool.runtime.language ?? "tool"}
                      </div>
                    </div>
                    {tool.tags.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {tool.tags.slice(0, 3).map((tag) => (
                          <span
                            key={`${tool.id}-${tag}`}
                            className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/46"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="min-h-0 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(5,8,12,0.96))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
          {!selectedToolId || detailLoading ? (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-2 h-6 w-64" />
                <Skeleton className="mt-2 h-4 w-full" />
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-10 w-full" />
                <Skeleton className="mt-2 h-10 w-full" />
                <Skeleton className="mt-2 h-10 w-full" />
              </div>
            </div>
          ) : !selectedTool ? (
            <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-white/12 bg-white/4 text-sm text-white/50">
              Select a tool to continue.
            </div>
          ) : (
            <div className="flex h-full flex-col gap-4 overflow-y-auto">
              <div className="rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.14),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-5 text-white">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <p className="font-mono text-[11px] text-white/46">
                      {selectedTool.id}
                    </p>
                    <h2 className="mt-2 font-semibold text-[24px] leading-tight tracking-[-0.03em]">
                      {selectedTool.name}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-white/62">
                      {selectedTool.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-white/68">
                        version{" "}
                        <span className="font-mono text-white">
                          {selectedTool.version}
                        </span>
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-white/68">
                        runtime{" "}
                        <span className="font-mono text-white">
                          {selectedTool.runtime.language ?? "n/a"}
                        </span>
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-white/68">
                        timeout{" "}
                        <span className="font-mono text-white">
                          {selectedTool.runtime.timeout ?? "-"}s
                        </span>
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-white/68">
                        async{" "}
                        <span className="font-mono text-white">
                          {selectedTool.hasExecutor ? "ready" : "n/a"}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-3 sm:items-end">
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a
                        href={`/dashboard/tools/${encodeURIComponent(selectedTool.id)}`}
                      >
                        <ExternalLinkIcon className="size-3.5" />
                        Open standalone
                      </a>
                    </Button>
                    {selectedTool.tags.length > 0 ? (
                      <div className="flex max-w-sm flex-wrap justify-end gap-1.5 text-[10px] text-white/52">
                        {selectedTool.tags.slice(0, 6).map((tag) => (
                          <span
                            key={`${selectedTool.id}-${tag}`}
                            className="rounded-full border border-white/10 bg-black/20 px-2 py-1"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,0.98fr)_minmax(360px,0.9fr)]">
                <div className="space-y-4">
                  <div className="rounded-[26px] border border-white/10 bg-white/5 p-4 text-white">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <WrenchIcon className="size-4 text-muted-foreground" />
                      <h3 className="font-semibold text-sm">Inputs</h3>
                    </div>
                    <p className="mt-2 text-[11px] leading-5 text-white/46">
                      One tool surface. Type, upload, then inspect the run from the console beside it.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        void onRunSync();
                      }}
                      disabled={busyMode !== null}
                    >
                      {busyMode === "sync" ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <PlayIcon className="size-4" />
                      )}
                      Run now
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void onRunAsync();
                      }}
                      disabled={busyMode !== null || !selectedTool.hasExecutor}
                    >
                      {busyMode === "async" ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <RocketIcon className="size-4" />
                      )}
                      Queue job
                    </Button>
                  </div>
                </div>

                {inputSpecs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    This tool has no input fields.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {inputSpecs.map((spec) => {
                      const value = inputValues[spec.name] ?? "";
                      const uploads = fieldUploads[spec.name] ?? [];
                      const isMultiFile = isMultiFileSpec(spec);
                      const fieldId =
                        `tool-input-${selectedTool.id}-${spec.name}`
                          .replace(/[^a-zA-Z0-9_-]/g, "-")
                          .toLowerCase();
                      const placeholder =
                        isMultiFile
                          ? "one file URL per line or comma-separated"
                          : spec.type === "file"
                            ? "file URL"
                            : spec.type === "number"
                              ? "number value"
                              : "enter value";
                      const fieldExpired = expiredInputFields.includes(
                        spec.name,
                      );

                      return (
                        <label
                          key={spec.name}
                          className="block"
                          htmlFor={fieldId}
                        >
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-medium">
                              {spec.name}{" "}
                              <span className="text-muted-foreground">
                                ({spec.type})
                              </span>
                            </span>
                            <span className="text-muted-foreground">
                              {renderInputHint(spec)}
                            </span>
                          </div>

                          {isMultiFile ? (
                            <textarea
                              id={fieldId}
                              value={value}
                              onChange={(event) => {
                                onChangeField(spec.name, event.target.value);
                              }}
                              placeholder={placeholder}
                              className={`min-h-24 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition-[border-color,box-shadow] placeholder:text-zinc-500 focus:border-sky-300/50 focus:ring-0 ${
                                fieldExpired
                                  ? "border-amber-300/70 bg-amber-300/10"
                                  : ""
                              }`}
                            />
                          ) : (
                            <Input
                              id={fieldId}
                              type={spec.type === "number" ? "number" : "text"}
                              value={value}
                              onChange={(event) => {
                                onChangeField(spec.name, event.target.value);
                              }}
                              placeholder={placeholder}
                              className={
                                fieldExpired
                                  ? "h-11 rounded-2xl border-amber-300/70 bg-amber-300/10 text-white placeholder:text-amber-100/50"
                                  : "h-11 rounded-2xl border-white/10 bg-black/20 text-white placeholder:text-zinc-500"
                              }
                            />
                          )}

                          {(spec.type === "file" || isMultiFile) && (
                            <div className="mt-2">
                              <label className="inline-flex">
                                <input
                                  type="file"
                                  className="hidden"
                                  multiple={isMultiFile}
                                  accept={
                                    spec.accepts.length > 0
                                      ? spec.accepts.join(",")
                                      : undefined
                                  }
                                  onChange={(event) => {
                                    void onUpload(spec, event.target.files);
                                    event.currentTarget.value = "";
                                  }}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="cursor-pointer"
                                  disabled={uploadingField === spec.name}
                                  asChild
                                >
                                  <span>
                                    {uploadingField === spec.name ? (
                                      <Loader2Icon className="size-3.5 animate-spin" />
                                    ) : (
                                      <UploadIcon className="size-3.5" />
                                    )}
                                    Upload {isMultiFile ? "files" : "file"}
                                  </span>
                                </Button>
                              </label>
                              <p className="mt-1 text-[11px] text-white/50">
                                Uploaded links auto-fill above. Multi-file
                                inputs accept one URL per line.
                              </p>
                              <p className="mt-1 flex items-center gap-1 text-[11px] text-white/46">
                                <InfoIcon className="size-3" />
                                Links are signed and can expire. Re-upload if
                                execution fails with missing artifact.
                              </p>
                              {uploads.length > 0 ? (
                                <div className="mt-2 space-y-1">
                                  {uploads.map((item) => {
                                    const expiresAt = getUploadExpiration(item);
                                    const expired = isUploadExpired(item);
                                    return (
                                      <a
                                        key={`${spec.name}-${item.url}`}
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-[11px] transition-colors hover:bg-white/8 ${
                                          expired
                                            ? "border-amber-300/70 bg-amber-300/10 text-amber-100"
                                            : "border-white/10 bg-black/20 text-white/78"
                                        }`}
                                      >
                                        <span className="truncate">
                                          {item.name}
                                        </span>
                                        <span className="ml-2 shrink-0 text-right">
                                          <span className="block text-muted-foreground">
                                            {formatBytes(item.size_bytes)}
                                          </span>
                                          <span
                                            className={
                                              expired
                                                ? "text-amber-100"
                                                : "text-white/46"
                                            }
                                          >
                                            {formatExpiry(expiresAt)}
                                          </span>
                                        </span>
                                      </a>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}

                {expiredInputFields.length > 0 ? (
                  <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-300/10 px-3 py-3 text-xs text-amber-100">
                    <p className="flex items-center gap-1.5">
                      <AlertTriangleIcon className="size-3.5" />
                      Expired upload URLs detected in{" "}
                      <span className="font-mono">
                        {expiredInputFields.join(", ")}
                      </span>
                      . Re-upload before running.
                    </p>
                  </div>
                ) : null}
              </div>

                  {error ? (
                    <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900 text-sm">
                      <p className="flex items-center gap-2">
                        <AlertTriangleIcon className="size-4" />
                        {error}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex min-h-[520px] flex-col rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(120,197,249,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4 text-white">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Clock3Icon className="size-4 text-muted-foreground" />
                        <h3 className="font-semibold text-sm">Console</h3>
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-white/46">
                        One switching surface for output, jobs, run events, and reuse history.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px] text-white/64">
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                        sync {syncResult ? "ready" : "idle"}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                        async {jobState?.status ?? "idle"}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                        history {combinedHistory.length}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {([
                      { id: "result" as const, label: "Result", icon: Clock3Icon, badge: syncOutputLinks.length > 0 || syncResult ? "live" : undefined },
                      { id: "job" as const, label: "Job", icon: RocketIcon, badge: jobState?.status },
                      { id: "timeline" as const, label: "Timeline", icon: ShieldIcon, badge: activeRunId ? String(runEvents.length) : undefined },
                      { id: "history" as const, label: "History", icon: HistoryIcon, badge: combinedHistory.length > 0 ? String(combinedHistory.length) : undefined },
                    ] as const).map((tab) => {
                      const Icon = tab.icon;
                      const active = consolePane === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setConsolePane(tab.id)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors ${active ? "border-sky-300/40 bg-sky-300/14 text-white" : "border-white/10 bg-black/20 text-white/58 hover:bg-white/8"}`}
                        >
                          <Icon className="size-3.5" />
                          {tab.label}
                          {tab.badge ? <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/82">{tab.badge}</span> : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex-1 overflow-hidden rounded-[22px] border border-white/10 bg-black/24 p-4">
                    <div className="h-full overflow-y-auto pr-1">
                      {consolePane === "result" ? (
                        <div className="space-y-3">
                          {lastSyncRunId ? <p className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px] text-white/74">last sync run: {lastSyncRunId}</p> : null}
                          {syncOutputLinks.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {syncOutputLinks.map((link) => (
                                <a key={`sync-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/80 transition-colors hover:bg-white/10">
                                  <ExternalLinkIcon className="size-3" />
                                  {link.label}
                                </a>
                              ))}
                            </div>
                          ) : null}
                          {syncResult ? <pre className="max-h-[420px] overflow-auto rounded-[20px] border border-white/10 bg-black/25 p-3 text-[11px] text-white/80">{formatJson(syncResult)}</pre> : <p className="text-sm text-white/50">No sync result yet.</p>}
                        </div>
                      ) : null}

                      {consolePane === "job" ? (
                        <div className="space-y-3 text-sm">
                          {jobState ? (
                            <>
                              <p className="font-mono text-[11px] text-muted-foreground">job: {jobState.job_id}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">run: {jobState.run_id}</p>
                              <div className="flex items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs">{jobState.status}</span>
                                <span className="text-xs text-white/52">progress {toPercentLabel(jobState.progress)}</span>
                              </div>
                              <div className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-black/20">
                                <div className="h-full bg-[linear-gradient(90deg,#38bdf8,#34d399)] transition-[width] duration-300" style={{ width: toPercentLabel(jobState.progress) }} />
                              </div>
                              {jobState.error ? <p className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900 text-xs">{jobState.error.code}: {jobState.error.message}</p> : null}
                              {asyncOutputLinks.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {asyncOutputLinks.map((link) => (
                                    <a key={`async-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/80 transition-colors hover:bg-white/10">
                                      <ExternalLinkIcon className="size-3" />
                                      {link.label}
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                              {jobState.result ? <pre className="max-h-[360px] overflow-auto rounded-[20px] border border-white/10 bg-black/25 p-3 text-[11px] text-white/80">{formatJson(jobState.result)}</pre> : null}
                            </>
                          ) : <p className="text-sm text-white/50">No async job started yet.</p>}
                        </div>
                      ) : null}

                      {consolePane === "timeline" ? (
                        <div className="space-y-3">
                          {activeRunId ? (
                            <>
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-mono">run: {activeRunId}</span>
                                <span className={`rounded-full border px-2 py-1 font-medium ${RUN_STATUS_STYLES[trackedRun?.status ?? "accepted"] ?? RUN_STATUS_STYLES.accepted}`}>{trackedRun?.status ?? "accepted"}</span>
                                <span className={`rounded-full border px-2 py-1 font-medium ${CONNECTION_STYLES[runConnection] ?? CONNECTION_STYLES.idle}`}>stream: {runConnection}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                {activeAuditContext.tenantId ? <span className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-mono"><ShieldIcon className="size-3" />tenant:{activeAuditContext.tenantId}</span> : null}
                                {activeAuditContext.apiKeyId ? <span className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-mono">key:{activeAuditContext.apiKeyId}</span> : null}
                                {activeAuditContext.source ? <span className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 font-mono">source:{activeAuditContext.source}</span> : null}
                              </div>
                              <div className="grid grid-cols-1 gap-1 text-[11px] text-white/50">
                                <div>accepted: <span className="text-foreground">{formatTimestamp(trackedRun?.acceptedAt)}</span></div>
                                <div>started: <span className="text-foreground">{formatTimestamp(trackedRun?.startedAt)}</span></div>
                                <div>ended: <span className="text-foreground">{formatTimestamp(trackedRun?.endedAt)}</span></div>
                              </div>
                              <div className="max-h-[360px] space-y-1 overflow-y-auto rounded-[20px] border border-white/10 bg-black/25 p-3">
                                {runEvents.length === 0 ? <p className="text-[11px] text-white/46">No run events yet.</p> : [...runEvents].reverse().map((event, index) => {
                                  const key = typeof event.eventId === "number" ? `evt-${event.eventId}` : `evt-${event.type}-${event.timestamp ?? index}`;
                                  return <div key={key} className="flex items-center justify-between gap-2 font-mono text-[11px]"><span className="truncate text-white/86">{event.type}</span><span className="shrink-0 text-white/44">{formatTimestamp(event.timestamp)}</span></div>;
                                })}
                              </div>
                            </>
                          ) : <p className="text-sm text-white/50">Run a tool to view lifecycle events.</p>}
                        </div>
                      ) : null}

                      {consolePane === "history" ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-white/46">Billing-backed history plus current session runs.</p>
                            <Button type="button" size="sm" variant="outline" disabled={historyRefreshing} onClick={() => { void refreshBillingData("manual"); }}>
                              {historyRefreshing ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
                              Refresh
                            </Button>
                          </div>
                          {historyError ? <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 text-xs">{historyError}</p> : null}
                          {historyLoading ? (
                            <div className="space-y-2">
                              {Array.from({ length: 4 }).map((_, index) => <div key={`history-skeleton-${index}`} className="rounded-[18px] border border-white/10 px-3 py-3"><Skeleton className="h-3 w-40" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-2 h-3 w-28" /></div>)}
                            </div>
                          ) : combinedHistory.length === 0 ? (
                            <p className="text-sm text-white/50">No execution history yet. Run a tool to create the first record.</p>
                          ) : (
                            <div className="space-y-2">
                              {combinedHistory.map((entry) => {
                                const key = buildHistoryKey(entry);
                                const canReuse = Boolean(entry.paramsSnapshot);
                                const isActive = activeRunId === entry.runId;
                                return (
                                  <div key={key} className={`rounded-[18px] border px-3 py-3 text-xs ${isActive ? "border-sky-300/40 bg-sky-300/10" : "border-white/10 bg-black/20"}`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate font-mono text-[11px]">{entry.tool}</p>
                                        <p className="truncate text-[11px] text-white/44">run {entry.runId}{entry.jobId ? ` | job ${entry.jobId}` : ""}</p>
                                      </div>
                                      <span className={`shrink-0 rounded-full border px-2 py-0.5 font-medium ${RUN_STATUS_STYLES[entry.status] ?? RUN_STATUS_STYLES.accepted}`}>{HISTORY_STATUS_LABELS[entry.status]}</span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/46">
                                      <span>{formatAge(entry.createdAt)}</span>
                                      <span>mode: {entry.mode}</span>
                                      {typeof entry.durationMs === "number" ? <span>{entry.durationMs}ms</span> : null}
                                      {typeof entry.creditsUsed === "number" ? <span>credits: {entry.creditsUsed}</span> : null}
                                      <span className="font-mono">{entry.origin}</span>
                                    </div>
                                    {entry.errorCode || entry.errorMessage ? <p className="mt-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-900">{entry.errorCode ? `${entry.errorCode}: ` : ""}{entry.errorMessage ?? "execution failed"}</p> : null}
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      <Button type="button" size="sm" variant="outline" disabled={!canReuse || busyMode !== null} onClick={() => { onQuickRerun(entry); }}>
                                        <RefreshCwIcon className="size-3.5" />
                                        Quick rerun
                                      </Button>
                                      <Button type="button" size="sm" variant="ghost" disabled={!canReuse} onClick={() => { onReuseParams(entry); }}>
                                        Reuse inputs
                                      </Button>
                                    </div>
                                    {!canReuse ? <p className="mt-1 text-[11px] text-muted-foreground">Parameter snapshot unavailable for this record.</p> : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

