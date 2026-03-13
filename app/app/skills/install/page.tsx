import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Bot,
  PackageOpen,
} from "lucide-react";
import {
  CodePanel,
  MarketingShell,
  SectionEyebrow,
} from "@/components/marketing/public-site-shell";
import {
  apiExamples,
  skillInstallTracks,
  skillPackFilesystem,
  skillPackPrinciples,
  skillQuickstarts,
} from "@/lib/config/platform-site";

export default function SkillsInstallPage() {
  return (
    <MarketingShell
      hero={
        <div className="grid gap-10 lg:grid-cols-[1.02fr_0.98fr] lg:items-end">
          <div className="max-w-3xl">
            <SectionEyebrow>Skills install guide</SectionEyebrow>
            <h1 className="mt-6 font-[family:var(--font-ark-serif)] text-5xl text-[#111318] leading-[0.98] tracking-[-0.05em] sm:text-6xl">
              Give your agent Ark tools in one command.
            </h1>
            <p className="mt-6 max-w-2xl text-[#5e564a] text-lg leading-8">
              Today&apos;s supported paths are straightforward: start a local
              Ark server, expose Ark over MCP, or install the thin SDK your
              agent already uses. Package `SKILL.md` workflow on top of those
              same primitives instead of building another runtime.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/developers"
                className="inline-flex items-center gap-2 rounded-full bg-[#111318] px-5 py-3 font-medium text-sm text-white transition hover:bg-[#23262e]"
              >
                Developer contract
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/docs#skills"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:border-black"
              >
                Docs section
              </Link>
            </div>
          </div>

          <div className="rounded-[32px] border border-black/8 bg-[#111318] p-8 text-white">
            <div className="text-[11px] text-white/42 uppercase tracking-[0.22em]">
              What is live right now
            </div>
            <div className="mt-5 grid gap-4">
              {[
                {
                  title: "REST + runtime key",
                  detail:
                    "The source of truth. Every install path still lands on the same execution API and tenant-scoped runtime key model.",
                  icon: Boxes,
                },
                {
                  title: "MCP adapter",
                  detail:
                    "Best for hosts that already understand tool protocols and want Ark's live catalog through stdio.",
                  icon: Bot,
                },
                {
                  title: "Files and artifacts",
                  detail:
                    "Skills stay useful when real inputs and outputs move through Ark's file and artifact boundary instead of plain text only.",
                  icon: PackageOpen,
                },
              ].map((item) => (
                <article
                  key={item.title}
                  className="rounded-[22px] border border-white/10 bg-white/6 px-5 py-5"
                >
                  <item.icon className="size-5 text-[#b0d4ff]" />
                  <div className="mt-3 font-semibold text-lg">{item.title}</div>
                  <div className="mt-2 text-sm text-white/70 leading-7">
                    {item.detail}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      }
    >
      <section className="grid gap-5 xl:grid-cols-2">
        {skillQuickstarts.map((item) => (
          <CodePanel
            key={item.id}
            title={item.title}
            subtitle={item.summary}
            code={item.command}
            note={item.note}
          />
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.04fr_0.96fr]">
        <article className="rounded-[32px] border border-black/8 bg-white p-8">
          <SectionEyebrow>Pick the install path</SectionEyebrow>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {skillInstallTracks.map((track) => (
              <div
                key={track.title}
                className="rounded-[22px] border border-[#e5dccb] bg-[#fbf8f1] px-5 py-5"
              >
                <div className="font-semibold text-[#111318] text-lg">
                  {track.title}
                </div>
                <div className="mt-3 text-[#625b4f] text-sm leading-7">
                  {track.detail}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-[24px] border border-[#e5dccb] bg-[#fbf8f1] px-5 py-5 text-[#3d3a34] text-sm leading-7">
            Today&apos;s honest product line is simple: Ark already ships REST,
            SDK, MCP, local runtime keys, and operator-managed tenant issuance.
            First-party packaged skill catalogs are still being productized on
            top of that same base.
          </div>
        </article>

        <article className="rounded-[32px] border border-black/8 bg-[#efe6d6] p-8">
          <SectionEyebrow>Skill pack filesystem</SectionEyebrow>
          <div className="mt-6 rounded-[24px] border border-black/8 bg-[#111318] px-5 py-5 text-white">
            <pre className="overflow-x-auto font-[family:var(--font-ark-mono)] text-[13px] text-white/90 leading-7">
              {skillPackFilesystem}
            </pre>
          </div>
          <div className="mt-5 space-y-3">
            {skillPackPrinciples.map((line) => (
              <div
                key={line}
                className="rounded-[20px] border border-black/8 bg-white px-4 py-4 text-[#3d3a34] text-sm leading-7"
              >
                {line}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <CodePanel
          title="Discover live tools"
          subtitle="See the current Ark catalog before packaging a skill"
          code={apiExamples.registry}
        />
        <CodePanel
          title="Run a real tool"
          subtitle="Skills eventually collapse to the same execute contract"
          code={apiExamples.sync}
        />
      </section>

      <section className="rounded-[32px] border border-black/8 bg-[#111318] px-8 py-8 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-3xl tracking-[-0.04em]">
              Start with the runtime, then package the workflow.
            </div>
            <div className="mt-2 max-w-2xl text-sm text-white/68 leading-7">
              If you need SDK samples, tenant key architecture, or the full
              endpoint contract, continue into the developer and docs surfaces.
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
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 font-medium text-sm text-white transition hover:bg-white/10"
            >
              Docs hub
            </Link>
            <Link
              href="/skills"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 font-medium text-sm text-white transition hover:bg-white/10"
            >
              Skills overview
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
