import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  KeyRound,
  Layers3,
  Server,
} from "lucide-react";
import {
  CodePanel,
  MarketingShell,
  SectionEyebrow,
} from "@/components/marketing/public-site-shell";
import { apiExamples } from "@/lib/config/platform-site";
import { appConfig } from "@/lib/config/app-config";
import { getPlatformContract } from "@/lib/server/platform-contract";

export default function DevelopersPage() {
  const contract = getPlatformContract();

  return (
    <MarketingShell
      hero={
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div className="max-w-3xl">
            <SectionEyebrow>Developers and API</SectionEyebrow>
            <h1 className="mt-6 font-[family:var(--font-ark-serif)] text-5xl text-[#111318] leading-[0.98] tracking-[-0.05em] sm:text-6xl">
              Integrate once.
              <br />
              Reach the whole Ark execution layer.
            </h1>
            <p className="mt-6 max-w-2xl text-[#5e564a] text-lg leading-8">
              Your agent keeps reasoning. Ark handles deterministic execution,
              async jobs, artifacts, files, downloads, conversions, and
              provider-backed work through one runtime contract.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded-full bg-[#111318] px-5 py-3 font-medium text-sm text-white transition hover:bg-[#23262e]"
              >
                Read docs
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/skills/install"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:border-black"
              >
                Agent install guide
              </Link>
              <Link
                href="/enterprise"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:border-black"
              >
                Enterprise path
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            {[
              {
                title: "One key model",
                detail:
                  "Deployment keys, tenant runtime keys, and managed tenant keys all describe the same execution boundary instead of separate runtimes.",
                icon: KeyRound,
              },
              {
                title: "Deterministic backend",
                detail:
                  "Ark is the execution layer beneath Web, island, SDK, MCP, and future skill packs, not another chat wrapper.",
                icon: Server,
              },
              {
                title: "Operator control plane",
                detail:
                  "Managed tenants, tenant inspection, key rotation, and usage visibility are already part of the current contract.",
                icon: Layers3,
              },
            ].map((item) => (
              <article
                key={item.title}
                className="rounded-[28px] border border-black/8 bg-white px-6 py-6"
              >
                <item.icon className="size-5 text-[#4d6b87]" />
                <div className="mt-4 font-semibold text-[#111318] text-xl tracking-[-0.03em]">
                  {item.title}
                </div>
                <div className="mt-3 text-[#625b4f] text-sm leading-7">
                  {item.detail}
                </div>
              </article>
            ))}
          </div>
        </div>
      }
    >
      <section className="grid gap-5 xl:grid-cols-3">
        <CodePanel
          title="Registry"
          subtitle="Public discovery"
          code={apiExamples.registry}
        />
        <CodePanel
          title="Sync execution"
          subtitle="Inline deterministic work"
          code={apiExamples.sync}
        />
        <CodePanel
          title="Async execution"
          subtitle="Artifact-heavy and long-running tasks"
          code={apiExamples.async}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-[32px] border border-black/8 bg-white p-8">
          <SectionEyebrow>Endpoint surface</SectionEyebrow>
          <div className="mt-6 space-y-3">
            {contract.endpoints.map((endpoint) => (
              <div
                key={`${endpoint.method}-${endpoint.path}`}
                className="rounded-[20px] border border-[#e5dccb] bg-[#fbf8f1] px-4 py-4"
              >
                <div className="font-[family:var(--font-ark-mono)] text-[#111318] text-sm">
                  {endpoint.method} {endpoint.path}
                </div>
                <div className="mt-2 text-[#625b4f] text-sm leading-7">
                  {endpoint.summary}
                </div>
                <div className="mt-2 text-[#7a7265] text-[11px] uppercase tracking-[0.18em]">
                  {endpoint.auth === "api_key" ? "API key required" : "Public"}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[32px] border border-black/8 bg-[#111318] p-8 text-white">
          <SectionEyebrow>Live adapters</SectionEyebrow>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {contract.integrations.map((integration) => (
              <div
                key={integration.id}
                className="rounded-[20px] border border-white/10 bg-white/6 px-4 py-4"
              >
                <div className="text-[11px] text-white/42 uppercase tracking-[0.18em]">
                  {integration.status}
                </div>
                <div className="mt-2 font-semibold text-lg">
                  {integration.name}
                </div>
                <div className="mt-2 text-sm text-white/70 leading-7">
                  {integration.summary}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-[22px] border border-white/10 bg-white/6 px-5 py-5">
            <div className="font-semibold text-lg">Current live catalog</div>
            <div className="mt-2 text-sm text-white/70 leading-7">
              {contract.tool_catalog.headline}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {contract.tool_catalog.category_breakdown
                .slice(0, 8)
                .map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="text-[11px] text-white/42 uppercase tracking-[0.18em]">
                      {item.id}
                    </div>
                    <div className="mt-2 font-semibold text-2xl">
                      {item.count}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        {[
          {
            title: "Start with REST",
            detail:
              "Tool discovery, file upload, sync execution, async jobs, and artifact delivery are enough to integrate most agents quickly.",
          },
          {
            title: "Move to SDK when velocity matters",
            detail:
              "Use the official TypeScript or Python client to remove repetitive HTTP glue without adding hidden orchestration.",
          },
          {
            title: "Use MCP when the host wants a tool protocol",
            detail:
              "The MCP adapter surfaces the same live tool catalog and forwards execution to the same Ark backend.",
          },
        ].map((item) => (
          <article
            key={item.title}
            className="rounded-[28px] border border-black/8 bg-white px-6 py-6"
          >
            <Braces className="size-5 text-[#4d6b87]" />
            <div className="mt-4 font-semibold text-[#111318] text-xl tracking-[-0.03em]">
              {item.title}
            </div>
            <div className="mt-3 text-[#625b4f] text-sm leading-7">
              {item.detail}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-[32px] border border-black/8 bg-[#efe6d6] px-8 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-3xl text-[#111318] tracking-[-0.04em]">
              Build on the execution layer, not beside it.
            </div>
            <div className="mt-2 max-w-2xl text-[#625b4f] text-sm leading-7">
              If you need rollout guidance, managed tenant architecture, or
              SDK-first integration patterns, move to the enterprise surface
              next.
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/enterprise"
              className="inline-flex items-center gap-2 rounded-full bg-[#111318] px-5 py-3 font-medium text-sm text-white transition hover:bg-[#23262e]"
            >
              Enterprise
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href={appConfig.links.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:border-black"
            >
              GitHub
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
