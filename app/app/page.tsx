import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Clock3,
  FolderOpen,
  Github,
  Mic,
  MonitorPlay,
  Music4,
  Server,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { appConfig } from "@/lib/config/app-config";

type CapabilityTone =
  | "cyan"
  | "orange"
  | "pink"
  | "violet"
  | "emerald"
  | "amber";

const showcaseCards = [
  {
    tag: "Audio Notes",
    title: "Record, transcribe, ask AI",
    subtitle: "mp3 -> text -> Ask AI",
    accent: "from-cyan-400/70 via-sky-400/30 to-transparent",
    badge: "To Text",
    meta: "Local capture + BYOK ASR",
  },
  {
    tag: "Screen Record",
    title: "Stop recording, keep the story",
    subtitle: "Video summary + markdown report",
    accent: "from-orange-400/70 via-amber-300/35 to-transparent",
    badge: "Saving",
    meta: "Gemini or Google-compatible analysis",
  },
  {
    tag: "Studio",
    title: "Remove background without leaving the island",
    subtitle: "Edit, outpaint, clean watermark",
    accent: "from-fuchsia-400/70 via-pink-400/30 to-transparent",
    badge: "Apply",
    meta: "Tool-first creative workflow",
  },
];

const featureScenes: Array<{
  title: string;
  copy: string;
  icon: ReactNode;
  tone: CapabilityTone;
  lines: string[];
}> = [
  {
    title: "Audio Notes",
    copy:
      "Capture a thought, hand it to speech-to-text, and continue the transcript as a live AI document.",
    icon: <Mic className="size-5" />,
    tone: "cyan",
    lines: ["recording 02:14", "to text", "ask ai"],
  },
  {
    title: "Screen Record",
    copy:
      "Screen capture turns into an explainable artifact instead of a dead clip. Stop once, summarize once, ship once.",
    icon: <MonitorPlay className="size-5" />,
    tone: "orange",
    lines: ["countdown", "recording", "report.md"],
  },
  {
    title: "Studio",
    copy:
      "Image editing stays surface-native: remove background, clean watermarks, outpaint, and route results back into tools.",
    icon: <WandSparkles className="size-5" />,
    tone: "pink",
    lines: ["remove background", "mask optional", "apply"],
  },
  {
    title: "Focus",
    copy:
      "Pomodoro is not a separate app. It is an island state with a calm timer, next action, and AI handoff at the end.",
    icon: <Clock3 className="size-5" />,
    tone: "violet",
    lines: ["deep work", "12:45", "log progress"],
  },
  {
    title: "NetEase",
    copy:
      "Music is part of the stack with search, playback, and account connection instead of a detached utility page.",
    icon: <Music4 className="size-5" />,
    tone: "emerald",
    lines: ["search", "results", "wave"],
  },
  {
    title: "Files",
    copy:
      "Recent artifacts stay resumable. The island can reopen the right file workflow without dropping the user into a dashboard maze.",
    icon: <FolderOpen className="size-5" />,
    tone: "amber",
    lines: ["resume", "open", "share"],
  },
];

const repoModules = [
  {
    title: "Native island runtime",
    detail:
      "Rust-native Windows shell with surface rendering, capture flows, resumable actions, and local file handoff.",
  },
  {
    title: "Operator dashboard",
    detail:
      "Next.js app for agent chat, tools, jobs, connections, open-source docs, and public landing pages.",
  },
  {
    title: "Self-hosted services",
    detail:
      "Optional PostgreSQL, Redis, MinIO, and executor services for local-first runs, files, and artifacts.",
  },
];

const providerGroups = [
  {
    label: "Chat and images",
    value: "OpenAI or your own compatible gateway",
  },
  {
    label: "Video reasoning",
    value: "Gemini or Google API",
  },
  {
    label: "Speech to text",
    value: "Volcengine ASR",
  },
  {
    label: "Infra",
    value: "Compose for Postgres, Redis, MinIO, executor",
  },
];

const quickstart = [
  "git clone https://github.com/Zluowa/Ark.git",
  "cd Ark",
  "pnpm --dir app install",
  "cp app/.env.example app/.env.local",
  "docker compose -f infra/docker-compose.yml up -d",
  "pnpm --dir app dev",
  "cargo run --manifest-path desktop/Cargo.toml -p omniagent-island",
];

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
      {children}
    </p>
  );
}

function HeroIsland({
  tag,
  title,
  subtitle,
  accent,
  badge,
  meta,
}: {
  tag: string;
  title: string;
  subtitle: string;
  accent: string;
  badge: string;
  meta: string;
}) {
  return (
    <article className="relative overflow-hidden rounded-[2.2rem] border border-white/10 bg-[#050810] p-5 text-white shadow-[0_22px_70px_rgba(2,6,23,0.38)]">
      <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${accent}`} />
      <div className="relative flex items-start justify-between gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
            {tag}
          </p>
          <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
            {title}
          </h3>
          <p className="mt-2 max-w-xs text-sm leading-7 text-slate-300">
            {subtitle}
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs text-slate-200">
          {badge}
        </div>
      </div>
      <div className="relative mt-8 rounded-[1.6rem] border border-white/8 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-slate-400">
          <span>Island surface</span>
          <span>{meta}</span>
        </div>
        <div className="mt-4 rounded-[1.5rem] bg-black/75 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{tag}</div>
              <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
            </div>
            <div className="rounded-full bg-white/10 px-3 py-1 text-xs">
              {badge}
            </div>
          </div>
          <div className="mt-4 h-1.5 rounded-full bg-white/8">
            <div className="h-full w-2/3 rounded-full bg-white/70" />
          </div>
        </div>
      </div>
    </article>
  );
}

function CapabilityMock({
  title,
  icon,
  tone,
  lines,
}: {
  title: string;
  icon: ReactNode;
  tone: CapabilityTone;
  lines: string[];
}) {
  const toneMap = {
    cyan: "bg-cyan-300 text-slate-950",
    orange: "bg-orange-300 text-slate-950",
    pink: "bg-pink-300 text-slate-950",
    violet: "bg-violet-300 text-slate-950",
    emerald: "bg-emerald-300 text-slate-950",
    amber: "bg-amber-300 text-slate-950",
  } as const;

  return (
    <div className="rounded-[1.9rem] border border-slate-200 bg-[#0b1018] p-4 text-white shadow-[0_18px_50px_rgba(15,23,42,0.14)]">
      <div className="rounded-[1.4rem] bg-black px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex size-9 items-center justify-center rounded-full ${toneMap[tone]}`}
            >
              {icon}
            </div>
            <div>
              <div className="text-sm font-medium">{title}</div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                island surface
              </div>
            </div>
          </div>
          <div className="h-2.5 w-2.5 rounded-full bg-white/50" />
        </div>
        <div className="mt-4 grid gap-2 text-xs text-slate-300">
          {lines.map((line, index) => (
            <div
              key={line}
              className={`rounded-full px-3 py-2 ${
                index === lines.length - 1
                  ? "bg-white/12 text-white"
                  : "bg-white/6"
              }`}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,_#061018_0%,_#0a1620_24%,_#f4f1e8_24%,_#f4f1e8_100%)] text-slate-950">
      <section className="relative isolate overflow-hidden border-b border-white/10 bg-[#061018] text-slate-50">
        <div className="absolute left-[-10rem] top-[-8rem] h-72 w-72 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="absolute right-[-8rem] top-12 h-64 w-64 rounded-full bg-orange-400/12 blur-3xl" />
        <div className="mx-auto max-w-7xl px-6 pb-24 pt-8 lg:px-10">
          <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-white/12 bg-white/6">
                <Sparkles className="size-5 text-cyan-200" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-cyan-100/65">
                  Open-source Dynamic Island
                </p>
                <h1 className="text-lg font-semibold">{appConfig.name}</h1>
              </div>
            </div>
            <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <Link href="#showcase" className="transition hover:text-white">
                Showcase
              </Link>
              <Link href="#quickstart" className="transition hover:text-white">
                Quickstart
              </Link>
              <Link href="/open-source" className="transition hover:text-white">
                Docs
              </Link>
              <Link
                href={appConfig.links.source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-4 py-2 text-white transition hover:bg-white/10"
              >
                <Github className="size-4" />
                GitHub
              </Link>
            </nav>
          </header>

          <div className="mt-18 grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="max-w-3xl">
              <p className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.26em] text-cyan-100/80">
                Product-first, self-hosted, forkable
              </p>
              <h2 className="mt-6 text-5xl font-semibold tracking-[-0.06em] text-balance sm:text-6xl">
                The Dynamic Island is not a widget. It is the workflow.
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Ark turns the island into an execution surface for
                capture, editing, files, music, focus, and AI handoff. The full
                stack is open-source, self-hosted, and designed around the
                native island itself, not bolted onto a dashboard later.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200"
                >
                  Open dashboard
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/open-source"
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  Read self-hosting guide
                </Link>
              </div>
              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-2xl font-semibold tracking-[-0.04em]">
                    6
                  </div>
                  <div className="mt-1 text-sm text-slate-300">
                    flagship island surfaces
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-2xl font-semibold tracking-[-0.04em]">
                    BYOK
                  </div>
                  <div className="mt-1 text-sm text-slate-300">
                    no bundled provider secrets
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <div className="text-2xl font-semibold tracking-[-0.04em]">
                    Local
                  </div>
                  <div className="mt-1 text-sm text-slate-300">
                    infra and artifact storage
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-x-8 top-12 h-64 rounded-full bg-cyan-300/10 blur-3xl" />
              <div className="relative grid gap-5">
                {showcaseCards.map((card, index) => (
                  <div
                    key={card.tag}
                    className={
                      index === 1
                        ? "lg:translate-x-10"
                        : index === 2
                          ? "lg:-translate-x-6"
                          : ""
                    }
                  >
                    <HeroIsland {...card} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="showcase" className="mx-auto max-w-7xl px-6 py-24 lg:px-10">
        <div className="max-w-3xl">
          <SectionEyebrow>Island showcase</SectionEyebrow>
          <h3 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl">
            Every major workflow is designed as an island-native state.
          </h3>
          <p className="mt-5 text-base leading-8 text-slate-600">
            The point is not to mirror a full app in miniature. The point is to
            let the next useful action happen from the smallest possible
            surface.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {featureScenes.map((scene) => (
            <article
              key={scene.title}
              className="grid gap-5 rounded-[2.2rem] border border-slate-200 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.08)] lg:grid-cols-[1.1fr_0.9fr]"
            >
              <div>
                <div className="inline-flex rounded-full border border-slate-200 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-500">
                  {scene.title}
                </div>
                <p className="mt-5 text-lg leading-8 text-slate-700">
                  {scene.copy}
                </p>
              </div>
              <CapabilityMock
                title={scene.title}
                icon={scene.icon}
                tone={scene.tone}
                lines={scene.lines}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-[#d5d7d1] bg-[#ebe7db]">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-22 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div>
            <SectionEyebrow>What ships</SectionEyebrow>
            <h3 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950">
              The repo is opinionated, but not closed.
            </h3>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-600">
              You get the island, the dashboard, the public website, and the
              local service wiring in one place. Swap providers, keep the shell,
              and publish your own fork without scrubbing private baggage.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {repoModules.map((module) => (
              <article
                key={module.title}
                className="rounded-[1.9rem] border border-[#d6d1c6] bg-white p-5"
              >
                <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Sparkles className="size-4" />
                </div>
                <h4 className="mt-5 text-xl font-semibold tracking-[-0.03em]">
                  {module.title}
                </h4>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  {module.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="quickstart" className="mx-auto max-w-7xl px-6 py-24 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionEyebrow>Quickstart</SectionEyebrow>
            <h3 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950">
              Fork it, bring your own keys, and boot the whole stack.
            </h3>
            <p className="mt-5 text-base leading-8 text-slate-600">
              No private relay is required. No internal project needs to be
              cloned first. The setup is public-safe and the env file ships with
              placeholders only.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {providerGroups.map((group) => (
                <article
                  key={group.label}
                  className="rounded-[1.7rem] border border-slate-200 bg-white px-5 py-4"
                >
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                    {group.label}
                  </p>
                  <p className="mt-2 text-base font-medium text-slate-900">
                    {group.value}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[2.3rem] border border-slate-200 bg-[#09131c] text-slate-100 shadow-[0_30px_120px_rgba(15,23,42,0.16)]">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.26em] text-slate-400">
              <span>Terminal</span>
              <span>7 commands</span>
            </div>
            <div className="space-y-3 px-5 py-5 font-mono text-[13px] leading-7">
              {quickstart.map((line) => (
                <div key={line} className="rounded-2xl bg-white/5 px-4 py-3">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#09131c] py-22 text-slate-50">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[1fr_1fr] lg:px-10">
          <div>
            <SectionEyebrow>
              <span className="text-cyan-200/75">Open-source contract</span>
            </SectionEyebrow>
            <h3 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-white">
              Publishable without the cleanup sprint.
            </h3>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
              The repo ships with a license, contributing guide, security
              policy, issue templates, CI, public docs, and a homepage that
              shows the product before the dashboard. That is the standard for
              this project now.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
              <ShieldCheck className="size-5 text-cyan-200" />
              <h4 className="mt-4 text-lg font-semibold">Public-safe envs</h4>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                `app/.env.example` contains placeholders only. No real key, no
                internal relay, no bundled secrets.
              </p>
            </article>
            <article className="rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
              <Server className="size-5 text-cyan-200" />
              <h4 className="mt-4 text-lg font-semibold">Self-hosted infra</h4>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                Docker Compose wiring for Postgres, Redis, MinIO, and executor
                is included for local reproducibility.
              </p>
            </article>
          </div>
        </div>

        <div className="mx-auto mt-12 flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 lg:px-10">
          <div>
            <div className="text-2xl font-semibold tracking-[-0.04em]">
              Ready to fork your own island?
            </div>
            <div className="mt-2 text-sm text-slate-400">
              Start from the docs, then move into the dashboard.
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={appConfig.links.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
            >
              <Github className="size-4" />
              View GitHub
            </Link>
            <Link
              href="/open-source"
              className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200"
            >
              Open docs
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
