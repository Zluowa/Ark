import Link from "next/link";
import { ArrowRight, ArrowUpRight, Braces, KeyRound, Layers3, Server } from "lucide-react";
import { CopyCommandButton } from "@/components/marketing/copy-command-button";
import { appConfig } from "@/lib/config/app-config";
import { getPlatformContract } from "@/lib/server/platform-contract";

const curlRegistry = `curl -s http://127.0.0.1:3010/api/v1/tools/registry`;
const curlSync = `curl -X POST http://127.0.0.1:3010/api/v1/execute \\
  -H "X-API-Key: $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"pdf.compress","params":{"file_url":"https://example.com/input.pdf"}}'`;
const curlAsync = `curl -X POST http://127.0.0.1:3010/api/v1/execute/async \\
  -H "X-API-Key: $ARK_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"media.download_video","params":{"url":"https://www.bilibili.com/video/BV..."}}'`;

const sectionBadge =
  "inline-flex items-center rounded-full bg-[#efebe6] px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-[#1a1a1a]";

const panel =
  "rounded-[28px] border border-[#dfd8d0] bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]";

function CodeCard({
  title,
  subtitle,
  command,
}: {
  title: string;
  subtitle: string;
  command: string;
}) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#111317] text-white">
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-white/44">
            {title}
          </div>
          <div className="mt-1 text-sm text-white/68">{subtitle}</div>
        </div>
        <CopyCommandButton command={command} />
      </div>
      <pre className="overflow-x-auto px-5 py-5 font-[family:var(--font-ark-mono)] text-[13px] leading-7 text-white/88">
        {command}
      </pre>
    </div>
  );
}

export default function DevelopersPage() {
  const contract = getPlatformContract();

  return (
    <main className="min-h-screen bg-[#f6f2e8] text-neutral-950">
      <div className="h-3 bg-[linear-gradient(90deg,#6ed7ff_0%,#c6f36d_28%,#ffb867_58%,#ff84d4_100%)]" />

      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-12 lg:px-10">
        <header className="grid gap-8 lg:grid-cols-[1fr_0.95fr] lg:items-end">
          <div className="max-w-3xl">
            <p className={sectionBadge}>Developers and API</p>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.06em] sm:text-6xl">
              One deployment key.
              <br />
              The Ark execution layer.
            </h1>
            <p className="mt-6 text-lg leading-8 text-neutral-600">
              Ark is not trying to be your agent. Your agent keeps the user
              conversation and reasoning. Ark handles deterministic execution,
              async jobs, files, and artifacts behind one API key.
            </p>
            <p className="mt-4 text-sm leading-7 text-neutral-500">
              Current live catalog: {contract.tool_catalog.total_tools} tools.
              The platform is being productized toward a 100+ tool execution
              layer without wasting model tokens on download, convert,
              transcribe, compress, or delivery work.
            </p>
            <p className="mt-4 text-sm leading-7 text-neutral-500">
              Open-source mode is still self-hosted and BYOK, but the repo now
              includes a real local <code>managed_ark_key</code> mode so
              operators can issue tenant-facing Ark keys without pushing
              provider keys into each client request.
            </p>
            <p className="mt-4 text-sm leading-7 text-neutral-500">
              That managed lane now includes tenant listing, tenant detail,
              usage visibility, and tenant-key rotation/revocation through the
              same operator control plane.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={appConfig.links.source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                <ArrowUpRight className="size-4" />
                View GitHub
              </Link>
              <Link
                href="/open-source"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
              >
                Open deployment docs
              </Link>
              <Link
                href={appConfig.links.source + "/blob/main/docs/LOCAL_AGENT_SERVER.md"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
              >
                Local agent server
                <ArrowUpRight className="size-4" />
              </Link>
              <Link
                href={appConfig.links.source + "/blob/main/docs/MCP_SERVER.md"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
              >
                MCP guide
                <ArrowUpRight className="size-4" />
              </Link>
              <Link
                href="/api/v1/platform"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
              >
                Machine-readable contract
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            <article className={panel}>
              <KeyRound className="size-5" />
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
                One key model
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                Every execution endpoint is designed around one tenant-scoped
                runtime key. In self-hosted mode, platform operators create
                tenants, receive tenant bootstrap keys, then let each tenant
                mint and revoke its own runtime keys online without restarting
                Ark.
              </p>
            </article>
            <article className={panel}>
              <Server className="size-5" />
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
                Deterministic execution
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                Ark is for the work your agent should not reason about with a
                model: download, transcode, extract, normalize, summarize into
                files, and return artifacts quickly.
              </p>
            </article>
            <article className={panel}>
              <Layers3 className="size-5" />
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
                Local tenant control plane
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                The public repo now includes a real self-hosted control plane:
                list tenants, create a tenant with default quota, issue its
                bootstrap key, rotate tenant runtime keys, and suspend access
                when needed.
              </p>
            </article>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className={panel}>
            <p className={sectionBadge}>Three surfaces</p>
            <div className="mt-6 space-y-4">
              {contract.products.map((surface) => (
                <article
                  key={surface.id}
                  className="rounded-[22px] border border-[#e3ddd6] bg-[#faf8f4] px-5 py-4"
                >
                  <div className="text-sm font-semibold">{surface.title}</div>
                  <div className="mt-2 text-sm leading-7 text-neutral-600">
                    {surface.summary}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-black/8 bg-[#111317] text-white">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.18em] text-white/44">
              <span>Platform contract</span>
              <span>{contract.tool_catalog.total_tools} tools live</span>
            </div>
            <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
              {contract.tool_catalog.category_breakdown.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[18px] border border-white/10 bg-white/6 px-4 py-4"
                >
                  <div className="text-xs uppercase tracking-[0.16em] text-white/42">
                    {item.id}
                  </div>
                  <div className="mt-2 text-2xl font-semibold">{item.count}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <CodeCard
            title="Registry"
            subtitle="Public tool discovery"
            command={curlRegistry}
          />
          <CodeCard
            title="Sync execute"
            subtitle="Deterministic work inline"
            command={curlSync}
          />
          <CodeCard
            title="Async execute"
            subtitle="Long-running work as jobs"
            command={curlAsync}
          />
          <article className="rounded-[28px] border border-black/8 bg-white p-6">
            <p className={sectionBadge}>Core endpoints</p>
            <div className="mt-6 space-y-3">
              {contract.endpoints.map((endpoint) => (
                <div
                  key={`${endpoint.method}-${endpoint.path}`}
                  className="rounded-[18px] border border-[#e3ddd6] bg-[#faf8f4] px-4 py-4"
                >
                  <div className="font-[family:var(--font-ark-mono)] text-sm text-neutral-900">
                    {endpoint.method} {endpoint.path}
                  </div>
                  <div className="mt-2 text-sm text-neutral-600">
                    {endpoint.summary}
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.16em] text-neutral-500">
                    {endpoint.auth === "api_key" ? "API key required" : "Public"}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {contract.service_modes.map((mode) => (
            <article key={mode.id} className={panel}>
              <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">
                {mode.status}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                {mode.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                {mode.summary}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <article className={panel}>
            <p className={sectionBadge}>Why agents use Ark</p>
            <div className="mt-6 space-y-4">
              <div className="rounded-[20px] border border-[#e3ddd6] bg-[#faf8f4] px-4 py-4">
                <div className="text-sm font-semibold">Save tokens</div>
                <div className="mt-2 text-sm leading-7 text-neutral-600">
                  Let the agent keep reasoning while Ark handles download,
                  conversion, file generation, and other deterministic work.
                </div>
              </div>
              <div className="rounded-[20px] border border-[#e3ddd6] bg-[#faf8f4] px-4 py-4">
                <div className="text-sm font-semibold">Return artifacts, not chat</div>
                <div className="mt-2 text-sm leading-7 text-neutral-600">
                  Ark is optimized around files and structured outputs: text,
                  markdown, subtitles, audio, video, images, and archives.
                </div>
              </div>
              <div className="rounded-[20px] border border-[#e3ddd6] bg-[#faf8f4] px-4 py-4">
                <div className="text-sm font-semibold">Start with REST, expand later</div>
                <div className="mt-2 text-sm leading-7 text-neutral-600">
                  REST, TypeScript SDK, Python SDK, and MCP are live today.
                  Skill packs still sit on the roadmap, on top of the same
                  execution layer.
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-[28px] border border-black/8 bg-[#12141a] p-6 text-white">
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/44">
              Current media boundary
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">
              Subtitle extraction is partially live, not fully universal yet.
            </h2>
            <div className="mt-5 space-y-3 text-sm leading-7 text-white/72">
              <p>{contract.current_boundaries.video_subtitles.remote_link_subtitles}</p>
              <p>{contract.current_boundaries.video_subtitles.local_video_transcription}</p>
              <p>{contract.current_boundaries.video_subtitles.youtube}</p>
              <p>{contract.current_boundaries.video_subtitles.xiaohongshu}</p>
            </div>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white/64">
              <Layers3 className="size-4" />
              Productize this next as a unified execution tool
            </div>
          </article>
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {contract.integrations.map((integration) => (
            <article key={integration.id} className={panel}>
              <Braces className="size-5" />
              <h2 className="mt-4 text-lg font-semibold tracking-[-0.03em]">
                {integration.name}
              </h2>
              <div className="mt-2 text-xs uppercase tracking-[0.16em] text-neutral-500">
                {integration.status}
              </div>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                {integration.summary}
              </p>
            </article>
          ))}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[2rem] bg-[#111214] px-6 py-6 text-white">
          <div>
            <div className="text-2xl font-semibold tracking-[-0.04em]">
              Build on Ark's execution layer.
            </div>
            <div className="mt-2 text-sm text-white/62">
              One key for the whole catalog today. Shared backend, Island and
              Web on top, agent integrations next.
            </div>
          </div>
          <Link
            href="/open-source"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
          >
            Deployment and self-hosting
            <ArrowRight className="size-4" />
          </Link>
        </section>
      </div>
    </main>
  );
}
