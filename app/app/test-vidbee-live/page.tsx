"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2Icon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";
import { executeToolSync, type ToolExecutionSuccess } from "@/lib/api/tooling";
import { VideoDownloader } from "@/components/a2ui/video-downloader";

type FlowId =
  | "video-info"
  | "download-video"
  | "download-audio"
  | "download-video-fallback";

type Phase = "idle" | "running" | "done" | "error";

type FlowSpec = {
  buttonLabel: string;
  description: string;
  id: FlowId;
  kind: "video" | "audio";
  tool: "media.video_info" | "media.download_video" | "media.download_audio";
  useFallbackUrl?: boolean;
};

type FlowState = {
  error?: string;
  phase: Phase;
  result?: Record<string, unknown>;
  runId?: string;
};

const COMPLETE_STATUS = { type: "complete" as const };

const FLOW_SPECS: FlowSpec[] = [
  {
    id: "video-info",
    tool: "media.video_info",
    kind: "video",
    buttonLabel: "Run video info",
    description:
      "Metadata should come back from VidBee and render as a full card.",
  },
  {
    id: "download-video",
    tool: "media.download_video",
    kind: "video",
    buttonLabel: "Run video download",
    description:
      "Video should download through VidBee and expose Ark output_file_url.",
  },
  {
    id: "download-audio",
    tool: "media.download_audio",
    kind: "audio",
    buttonLabel: "Run audio download",
    description:
      "Audio should download through VidBee and still render a usable save card.",
  },
  {
    id: "download-video-fallback",
    tool: "media.download_video",
    kind: "video",
    useFallbackUrl: true,
    buttonLabel: "Run fallback download",
    description:
      "VidBee failure should fall back to legacy_internal without breaking the UI card.",
  },
];

const DEFAULT_VIDEO_URL =
  process.env.NEXT_PUBLIC_VIDBEE_PROOF_VIDEO_URL?.trim() ||
  "https://www.youtube.com/watch?v=remote_vidbee_mock";

const DEFAULT_FALLBACK_URL =
  process.env.NEXT_PUBLIC_VIDBEE_PROOF_FALLBACK_URL?.trim() ||
  "http://127.0.0.1:4512/fixtures/direct.mp4?force_fallback=1";

const initialState = (): Record<FlowId, FlowState> => ({
  "video-info": { phase: "idle" },
  "download-video": { phase: "idle" },
  "download-audio": { phase: "idle" },
  "download-video-fallback": { phase: "idle" },
});

const isSuccess = (
  value: unknown,
): value is ToolExecutionSuccess & { result: Record<string, unknown> } => {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { status?: unknown }).status === "success" &&
      typeof (value as { run_id?: unknown }).run_id === "string",
  );
};

const badgeClassName = (phase: Phase): string => {
  if (phase === "done") {
    return "border-emerald-400/30 bg-emerald-500/12 text-emerald-300";
  }
  if (phase === "error") {
    return "border-rose-400/30 bg-rose-500/12 text-rose-300";
  }
  if (phase === "running") {
    return "border-sky-400/30 bg-sky-500/12 text-sky-300";
  }
  return "border-white/10 bg-white/5 text-white/55";
};

export default function TestVidBeeLivePage() {
  const [videoUrl, setVideoUrl] = useState(DEFAULT_VIDEO_URL);
  const [fallbackUrl, setFallbackUrl] = useState(DEFAULT_FALLBACK_URL);
  const [flows, setFlows] = useState<Record<FlowId, FlowState>>(initialState);

  const orderedSpecs = useMemo(() => FLOW_SPECS, []);

  const runFlow = async (spec: FlowSpec) => {
    setFlows((current) => ({
      ...current,
      [spec.id]: { phase: "running" },
    }));

    const url = spec.useFallbackUrl ? fallbackUrl.trim() : videoUrl.trim();
    try {
      const response = await executeToolSync(spec.tool, { url });
      if (!isSuccess(response)) {
        const message =
          response?.error?.message || `${spec.tool} failed without message.`;
        setFlows((current) => ({
          ...current,
          [spec.id]: { phase: "error", error: message },
        }));
        return;
      }

      setFlows((current) => ({
        ...current,
        [spec.id]: {
          phase: "done",
          result: response.result,
          runId: response.run_id,
        },
      }));
    } catch (error) {
      setFlows((current) => ({
        ...current,
        [spec.id]: {
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const runAll = async () => {
    for (const spec of orderedSpecs) {
      // Keep proof order deterministic for screenshots.
      // eslint-disable-next-line no-await-in-loop
      await runFlow(spec);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_22%),linear-gradient(180deg,#05070b,#0a1016)] px-5 py-8 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] shadow-[0_28px_100px_rgba(0,0,0,0.35)]">
          <div className="border-white/8 border-b px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-[11px] text-sky-300/70 uppercase tracking-[0.28em]">
                  Live VidBee Proof
                </p>
                <h1 className="font-semibold text-2xl tracking-tight">
                  Real media flow verification
                </h1>
                <p className="max-w-3xl text-sm text-white/62 leading-6">
                  This page does not use mock widget data. Each button calls Ark
                  `/api/v1/execute` in the browser, then renders the returned
                  result through the real A2UI card.
                </p>
              </div>
              <button
                type="button"
                onClick={runAll}
                className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/15 px-4 py-2 text-sky-200 text-sm transition-colors hover:bg-sky-500/22"
              >
                <RefreshCwIcon className="size-4" />
                Run all flows
              </button>
            </div>
          </div>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
            <label className="space-y-2">
              <span className="font-medium text-white/45 text-xs uppercase tracking-[0.18em]">
                Primary video URL
              </span>
              <input
                value={videoUrl}
                onChange={(event) => setVideoUrl(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/25"
              />
            </label>
            <label className="space-y-2">
              <span className="font-medium text-white/45 text-xs uppercase tracking-[0.18em]">
                Fallback direct URL
              </span>
              <input
                value={fallbackUrl}
                onChange={(event) => setFallbackUrl(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/25"
              />
            </label>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          {orderedSpecs.map((spec) => {
            const flow = flows[spec.id];
            const provider =
              typeof flow.result?.provider === "string"
                ? flow.result.provider
                : undefined;
            const platform =
              typeof flow.result?.platform === "string"
                ? flow.result.platform
                : undefined;
            const outputUrl =
              typeof flow.result?.output_file_url === "string"
                ? flow.result.output_file_url
                : undefined;

            return (
              <article
                key={spec.id}
                data-testid={`flow-${spec.id}`}
                data-phase={flow.phase}
                data-provider={provider ?? ""}
                data-platform={platform ?? ""}
                data-output-url={outputUrl ?? ""}
                className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))]"
              >
                <div className="border-white/8 border-b px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="font-medium text-lg">{spec.buttonLabel}</p>
                      <p className="max-w-xl text-sm text-white/58 leading-6">
                        {spec.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={`run-${spec.id}`}
                      onClick={() => runFlow(spec)}
                      className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
                    >
                      {flow.phase === "running" ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <PlayIcon className="size-4" />
                      )}
                      Run
                    </button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${badgeClassName(flow.phase)}`}
                    >
                      {flow.phase === "done" && (
                        <CheckCircle2Icon className="size-3.5" />
                      )}
                      {flow.phase === "error" && (
                        <XCircleIcon className="size-3.5" />
                      )}
                      {flow.phase === "running" && (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      )}
                      {flow.phase}
                    </span>
                    {provider && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/72">
                        provider: {provider}
                      </span>
                    )}
                    {platform && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/72">
                        platform: {platform}
                      </span>
                    )}
                    {flow.runId && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-white/60">
                        run: {flow.runId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="px-5 py-5">
                  {flow.phase === "idle" && (
                    <div className="rounded-[24px] border border-white/10 border-dashed bg-black/20 px-4 py-10 text-center text-sm text-white/40">
                      Waiting for interaction.
                    </div>
                  )}

                  {flow.phase === "running" && (
                    <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-white/10 bg-black/20">
                      <div className="flex items-center gap-3 text-sm text-white/60">
                        <Loader2Icon className="size-4 animate-spin" />
                        Running {spec.tool}...
                      </div>
                    </div>
                  )}

                  {flow.phase === "error" && (
                    <div className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 px-4 py-4 text-rose-200 text-sm leading-6">
                      {flow.error}
                    </div>
                  )}

                  {flow.phase === "done" && flow.result && (
                    <div className="space-y-3">
                      <VideoDownloader
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        {...({
                          toolName: spec.tool,
                          status: COMPLETE_STATUS,
                          result: flow.result,
                        } as any)}
                      />
                      {outputUrl && (
                        <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-white/55 text-xs">
                          output_file_url:{" "}
                          <span className="font-mono text-white/72">
                            {outputUrl}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
