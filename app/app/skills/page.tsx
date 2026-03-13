import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Bot,
  Layers3,
  PackageOpen,
  PlugZap,
} from "lucide-react";
import {
  CodePanel,
  MarketingShell,
  SectionEyebrow,
} from "@/components/marketing/public-site-shell";
import {
  skillInstallTracks,
  skillPackFilesystem,
  skillPackPrinciples,
  skillQuickstarts,
  skillStories,
} from "@/lib/config/platform-site";

export default function SkillsPage() {
  return (
    <MarketingShell
      hero={
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div className="max-w-3xl">
            <SectionEyebrow>Skills</SectionEyebrow>
            <h1 className="mt-6 font-[family:var(--font-ark-serif)] text-5xl text-[#111318] leading-[0.98] tracking-[-0.05em] sm:text-6xl">
              Skills are the workflow layer above Ark, not a separate runtime.
            </h1>
            <p className="mt-6 max-w-2xl text-[#5e564a] text-lg leading-8">
              If a team already has Web, desktop, REST, SDK, and MCP running on
              one backend, the next acceleration layer is not another service.
              It is a reusable skill package that composes the same execution
              primitives.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/skills/install"
                className="inline-flex items-center gap-2 rounded-full bg-[#111318] px-5 py-3 font-medium text-sm text-white transition hover:bg-[#23262e]"
              >
                Install and use today
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/docs#skills"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:border-black"
              >
                Read the skills section
              </Link>
            </div>
          </div>

          <div className="rounded-[32px] border border-black/8 bg-[#111318] p-8 text-white">
            <div className="text-[11px] text-white/42 uppercase tracking-[0.22em]">
              Skill stack
            </div>
            <div className="mt-5 grid gap-4">
              {[
                {
                  title: "Registry",
                  detail:
                    "Discover tools, categories, and output types dynamically.",
                  icon: Layers3,
                },
                {
                  title: "Execution",
                  detail:
                    "Call sync and async work through the shared API contract.",
                  icon: Bot,
                },
                {
                  title: "Artifacts",
                  detail:
                    "Return files, bundles, media, and structured outputs cleanly.",
                  icon: PackageOpen,
                },
                {
                  title: "Reuse",
                  detail:
                    "Package those flows once so multiple agents can call them consistently.",
                  icon: Boxes,
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
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {skillStories.map((story) => (
          <article
            key={story.title}
            className="rounded-[28px] border border-black/8 bg-white px-6 py-6"
          >
            <div className="font-semibold text-[#111318] text-xl tracking-[-0.03em]">
              {story.title}
            </div>
            <div className="mt-3 text-[#625b4f] text-sm leading-7">
              {story.detail}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-[32px] border border-black/8 bg-[#111318] p-8 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionEyebrow>Use today</SectionEyebrow>
            <div className="mt-5 max-w-2xl font-semibold text-3xl tracking-[-0.04em]">
              The fastest way to give an agent Ark skills today is one command,
              not a new workflow engine.
            </div>
            <div className="mt-3 max-w-2xl text-sm text-white/68 leading-7">
              Today&apos;s supported install paths are MCP, the official SDKs,
              and the local Ark agent server. Packaged first-party skill packs
              are still being productized.
            </div>
          </div>
          <Link
            href="/skills/install"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:bg-[#ececec]"
          >
            Open install guide
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="mt-8 grid gap-5 xl:grid-cols-2">
          {skillQuickstarts.slice(0, 2).map((item) => (
            <CodePanel
              key={item.id}
              title={item.title}
              subtitle={item.summary}
              code={item.command}
              note={item.note}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[32px] border border-black/8 bg-white p-8">
          <SectionEyebrow>How to think about skills</SectionEyebrow>
          <div className="mt-6 grid gap-4">
            {[
              "A skill should compress repeated tool-calling and file-handling patterns.",
              "A skill should stay compatible with the same runtime whether the caller is Web, desktop, or enterprise.",
              "A skill should be able to ride on REST, SDK, or MCP instead of duplicating provider logic.",
              "A skill should make operators faster without hiding the platform contract.",
            ].map((line) => (
              <div
                key={line}
                className="rounded-[20px] border border-[#e5dccb] bg-[#fbf8f1] px-4 py-4 text-[#3d3a34] text-sm leading-7"
              >
                {line}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[32px] border border-black/8 bg-[#efe6d6] p-8">
          <SectionEyebrow>Current state</SectionEyebrow>
          <div className="mt-6 grid gap-4">
            <div className="rounded-[22px] border border-black/8 bg-white px-5 py-5">
              <div className="font-semibold text-[#111318] text-lg">
                Live today
              </div>
              <div className="mt-3 text-[#625b4f] text-sm leading-7">
                REST API, TypeScript SDK, Python SDK, MCP, files, async jobs,
                artifacts, account/workspace model, and managed tenant controls.
              </div>
            </div>
            <div className="rounded-[22px] border border-black/8 bg-white px-5 py-5">
              <div className="font-semibold text-[#111318] text-lg">
                Productizing next
              </div>
              <div className="mt-3 text-[#625b4f] text-sm leading-7">
                First-party skill packaging and a cleaner public registry story
                on top of the same execution primitives.
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[32px] border border-black/8 bg-white p-8">
          <SectionEyebrow>Choose the path</SectionEyebrow>
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
        </article>

        <article className="rounded-[32px] border border-black/8 bg-[#efe6d6] p-8">
          <SectionEyebrow>Skill pack contract</SectionEyebrow>
          <div className="mt-6 rounded-[24px] border border-black/8 bg-[#111318] px-5 py-5 text-white">
            <div className="flex items-center gap-2 text-[11px] text-white/42 uppercase tracking-[0.22em]">
              <PlugZap className="size-3.5" />
              Filesystem shape
            </div>
            <pre className="mt-4 overflow-x-auto font-[family:var(--font-ark-mono)] text-[13px] text-white/90 leading-7">
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

      <section className="rounded-[32px] border border-black/8 bg-[#111318] px-8 py-8 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-3xl tracking-[-0.04em]">
              Skills accelerate the platform. They do not replace it.
            </div>
            <div className="mt-2 max-w-2xl text-sm text-white/68 leading-7">
              Start from the shared Ark contract, then decide whether your team
              needs plain REST, SDK ergonomics, MCP compatibility, or a packaged
              skill layer.
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/skills/install"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium text-[#111318] text-sm transition hover:bg-[#ececec]"
            >
              Install guide
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/developers"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 font-medium text-sm text-white transition hover:bg-white/10"
            >
              Developers
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 font-medium text-sm text-white transition hover:bg-white/10"
            >
              Docs hub
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
