import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Layers3,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import {
  CodePanel,
  MarketingShell,
  SectionEyebrow,
} from "@/components/marketing/public-site-shell";
import {
  apiExamples,
  docsSections,
  operatingModes,
} from "@/lib/config/platform-site";
import { getPlatformContract } from "@/lib/server/platform-contract";

const quickstart = [
  "pnpm onboard --yes --profile full",
  "pnpm --dir app dev",
  "cargo run --manifest-path desktop/Cargo.toml -p omniagent-island",
  "open http://127.0.0.1:3010",
] as const;

const deploymentLinks = [
  {
    label: "API platform",
    href: "https://github.com/Zluowa/Ark/blob/main/docs/API_PLATFORM.md",
  },
  {
    label: "Self hosting",
    href: "https://github.com/Zluowa/Ark/blob/main/docs/SELF_HOSTING.md",
  },
  {
    label: "Local agent server",
    href: "https://github.com/Zluowa/Ark/blob/main/docs/LOCAL_AGENT_SERVER.md",
  },
  {
    label: "MCP guide",
    href: "https://github.com/Zluowa/Ark/blob/main/docs/MCP_SERVER.md",
  },
] as const;

export default function DocsPage() {
  const contract = getPlatformContract();

  return (
    <MarketingShell
      hero={
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div className="max-w-3xl">
            <SectionEyebrow>Docs hub</SectionEyebrow>
            <h1 className="mt-6 font-[family:var(--font-ark-serif)] text-5xl text-[#111318] leading-[0.98] tracking-[-0.05em] sm:text-6xl">
              Professional docs for one platform, not isolated features.
            </h1>
            <p className="mt-6 max-w-2xl text-[#5e564a] text-lg leading-8">
              Start from product truth. Then move through operating mode,
              identity, API, SDK, skills, deployment, and live boundaries
              without switching to a different story on every page.
            </p>
          </div>

          <div className="rounded-[30px] border border-black/8 bg-white p-6 shadow-[0_18px_36px_rgba(15,23,42,0.05)]">
            <div className="text-[#7a7265] text-[11px] uppercase tracking-[0.22em]">
              Table of contents
            </div>
            <div className="mt-5 grid gap-3">
              {docsSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="rounded-[20px] border border-[#e6decd] bg-[#fbf8f1] px-4 py-4 transition hover:border-black/14"
                >
                  <div className="font-semibold text-[#111318] text-sm">
                    {section.title}
                  </div>
                  <div className="mt-2 text-[#625b4f] text-sm leading-7">
                    {section.summary}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <section className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-28 rounded-[26px] border border-black/8 bg-white p-5">
            <div className="text-[#7a7265] text-[11px] uppercase tracking-[0.22em]">
              On this page
            </div>
            <nav className="mt-5 space-y-2">
              {docsSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block rounded-2xl px-3 py-2 text-[#3a3833] text-sm transition hover:bg-[#f4eee1]"
                >
                  {section.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="space-y-12">
          <section
            id="overview"
            className="rounded-[32px] border border-black/8 bg-white p-8"
          >
            <SectionEyebrow>Overview</SectionEyebrow>
            <h2 className="mt-5 font-semibold text-3xl text-[#111318] tracking-[-0.04em]">
              Ark has one execution core and four public-facing lanes.
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {contract.products.map((surface) => (
                <article
                  key={surface.id}
                  className="rounded-[22px] border border-[#e5dccb] bg-[#fbf8f1] px-5 py-5"
                >
                  <div className="text-[#7a7265] text-[11px] uppercase tracking-[0.18em]">
                    {surface.audience}
                  </div>
                  <div className="mt-2 font-semibold text-[#111318] text-lg">
                    {surface.title}
                  </div>
                  <div className="mt-2 text-[#625b4f] text-sm leading-7">
                    {surface.summary}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section
            id="modes"
            className="rounded-[32px] border border-black/8 bg-[#111318] p-8 text-white"
          >
            <SectionEyebrow>Operating modes</SectionEyebrow>
            <h2 className="mt-5 font-semibold text-3xl tracking-[-0.04em]">
              Managed and self-hosted are packaging modes of the same system.
            </h2>
            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              {operatingModes.map((mode) => (
                <article
                  key={mode.id}
                  className="rounded-[22px] border border-white/10 bg-white/6 px-5 py-5"
                >
                  <div className="text-[11px] text-white/42 uppercase tracking-[0.18em]">
                    {mode.id}
                  </div>
                  <div className="mt-2 font-semibold text-xl">{mode.title}</div>
                  <div className="mt-3 text-sm text-white/70 leading-7">
                    {mode.summary}
                  </div>
                  <ul className="mt-5 space-y-3">
                    {mode.bullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/78 leading-7"
                      >
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section
            id="identity"
            className="rounded-[32px] border border-black/8 bg-white p-8"
          >
            <SectionEyebrow>Account and key model</SectionEyebrow>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                {
                  title: "Browser account",
                  detail:
                    "People sign in once and keep workspace, settings, and usage in a browser session.",
                  icon: Layers3,
                },
                {
                  title: "Runtime API key",
                  detail:
                    "Agents and enterprise services call execute, async jobs, files, and admin endpoints with one deployment or tenant key.",
                  icon: ShieldCheck,
                },
                {
                  title: "Managed tenant path",
                  detail:
                    "Operators can issue tenant-facing Ark keys without pushing raw provider keys into every client request.",
                  icon: Workflow,
                },
              ].map((item) => (
                <article
                  key={item.title}
                  className="rounded-[22px] border border-[#e5dccb] bg-[#fbf8f1] px-5 py-5"
                >
                  <item.icon className="size-5 text-[#4d6b87]" />
                  <div className="mt-3 font-semibold text-[#111318] text-lg">
                    {item.title}
                  </div>
                  <div className="mt-2 text-[#625b4f] text-sm leading-7">
                    {item.detail}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section id="api" className="grid gap-5 xl:grid-cols-3">
            <CodePanel
              title="Registry"
              subtitle="Public tool discovery"
              code={apiExamples.registry}
            />
            <CodePanel
              title="Sync execute"
              subtitle="Deterministic work inline"
              code={apiExamples.sync}
            />
            <CodePanel
              title="Async execute"
              subtitle="Long-running work as jobs"
              code={apiExamples.async}
            />
          </section>

          <section id="sdk" className="grid gap-5 xl:grid-cols-2">
            <CodePanel
              title="TypeScript SDK"
              subtitle="Thin client over the execution API"
              code={apiExamples.typescript}
            />
            <CodePanel
              title="Python SDK"
              subtitle="Backend and worker integration"
              code={apiExamples.python}
            />
          </section>

          <section
            id="skills"
            className="rounded-[32px] border border-black/8 bg-white p-8"
          >
            <SectionEyebrow>Skills</SectionEyebrow>
            <h2 className="mt-5 font-semibold text-3xl text-[#111318] tracking-[-0.04em]">
              Skills package workflow on top of the live execution primitives.
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                "Registry and platform discovery tell a skill what Ark can do.",
                "Files and artifacts let a skill move real inputs and outputs, not just chat text.",
                "Sync and async execution keep short and long tasks on the same API model.",
                "REST, TypeScript, Python, and MCP are the current adapters a skill can build on.",
              ].map((line) => (
                <div
                  key={line}
                  className="rounded-[20px] border border-[#e5dccb] bg-[#fbf8f1] px-4 py-4 text-[#3d3a34] text-sm leading-7"
                >
                  {line}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/skills"
                className="inline-flex items-center gap-2 rounded-full bg-[#111318] px-5 py-3 font-medium text-sm text-white transition hover:bg-[#23262e]"
              >
                Open skills page
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/skills/install"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:border-black"
              >
                Install and use
              </Link>
              <Link
                href="/developers"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:border-black"
              >
                Developer contract
              </Link>
            </div>
          </section>

          <section
            id="deployment"
            className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]"
          >
            <article className="rounded-[32px] border border-black/8 bg-[#111318] p-8 text-white">
              <SectionEyebrow>Quickstart</SectionEyebrow>
              <div className="mt-6 space-y-3 font-[family:var(--font-ark-mono)] text-[13px] leading-7">
                {quickstart.map((line) => (
                  <div
                    key={line}
                    className="rounded-[18px] border border-white/10 bg-white/6 px-4 py-3"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[32px] border border-black/8 bg-white p-8">
              <SectionEyebrow>Deployment references</SectionEyebrow>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {deploymentLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-[22px] border border-[#e5dccb] bg-[#fbf8f1] px-5 py-5 transition hover:border-black/14"
                  >
                    <div className="font-semibold text-[#111318] text-lg">
                      {link.label}
                    </div>
                    <div className="mt-4 inline-flex items-center gap-2 font-medium text-[#4d6b87] text-sm">
                      Open
                      <ArrowUpRight className="size-4" />
                    </div>
                  </Link>
                ))}
              </div>
            </article>
          </section>

          <section
            id="truth"
            className="rounded-[32px] border border-black/8 bg-[#efe6d6] p-8"
          >
            <SectionEyebrow>Live now vs roadmap</SectionEyebrow>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <article className="rounded-[24px] border border-black/8 bg-white px-5 py-5">
                <div className="font-semibold text-[#111318] text-lg">
                  Live now
                </div>
                <ul className="mt-4 space-y-3 text-[#625b4f] text-sm leading-7">
                  <li>
                    Browser account login and workspace-bound consumer session
                  </li>
                  <li>REST API, TypeScript SDK, Python SDK, and MCP adapter</li>
                  <li>
                    Self-hosted BYOK deployment plus managed Ark key operator
                    mode
                  </li>
                  <li>
                    Dashboard usage, account, workspace, and developer control
                    surfaces
                  </li>
                </ul>
              </article>
              <article className="rounded-[24px] border border-black/8 bg-white px-5 py-5">
                <div className="font-semibold text-[#111318] text-lg">
                  Still being productized
                </div>
                <ul className="mt-4 space-y-3 text-[#625b4f] text-sm leading-7">
                  <li>
                    Hosted self-serve billing and a full SaaS operator plane
                  </li>
                  <li>
                    Packaged first-party Ark skill catalog above the same
                    execution API
                  </li>
                  <li>
                    Broader managed rollout and per-tenant hosted controls
                  </li>
                  <li>
                    More universal platform parity across every media boundary
                  </li>
                </ul>
              </article>
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-[32px] border border-black/8 bg-[#111318] px-8 py-8 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-3xl tracking-[-0.04em]">
              Build from product truth, then scale outward.
            </div>
            <div className="mt-2 text-sm text-white/68">
              Docs should lead users from account to API to deployment without
              changing the system model halfway through.
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/developers"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:bg-[#ececec]"
            >
              Developers
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/open-source"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 font-medium text-sm text-white transition hover:bg-white/10"
            >
              Open source
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
