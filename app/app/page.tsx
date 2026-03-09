import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  Command,
  FileStack,
  FileText,
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

const heroSurfaces = [
  {
    label: "Audio Notes",
    title: "Record, transcribe, ask AI",
    detail: "mp3 -> text -> Ask AI",
    chip: "To Text",
    accent: "bg-cyan-300",
  },
  {
    label: "Screen Record",
    title: "Stop once, keep the story",
    detail: "countdown -> recording -> report.md",
    chip: "Saving",
    accent: "bg-amber-300",
  },
  {
    label: "Studio",
    title: "Edit without leaving the island",
    detail: "remove background, clean watermark, apply",
    chip: "Apply",
    accent: "bg-fuchsia-300",
  },
];

const worksWith = [
  "OpenAI",
  "Gemini",
  "Volcengine",
  "ffmpeg",
  "Rust",
  "Next.js",
];

const orchestrationSteps = [
  {
    step: "01",
    title: "Capture the signal",
    copy:
      "Start from the island itself: audio notes, screen recording, image editing, music, files, or focus.",
  },
  {
    step: "02",
    title: "Transform it in place",
    copy:
      "Convert files, transcribe recordings, resume recent artifacts, or hand the current state to a tool without reopening the whole app.",
  },
  {
    step: "03",
    title: "Handoff with context",
    copy:
      "Push the result back into AI, files, or the dashboard with the right context already attached.",
  },
];

const fitList = [
  "You want the Dynamic Island to be a real workflow surface, not just a status ornament.",
  "You capture audio, screen, files, or image edits and want the next action to happen from the same surface.",
  "You need a local-first stack with BYOK providers instead of a hosted black box.",
  "You want a public repo you can fork, self-host, and keep hacking on without internal cleanup first.",
  "You want one system that connects the island, dashboard, tools, and file handoff instead of isolated widgets.",
];

const featureCards = [
  {
    title: "Audio Notes",
    copy:
      "Record, convert to text, then continue the transcript through normal AI input instead of a dead export flow.",
    icon: <Mic className="size-5" />,
  },
  {
    title: "Screen Record",
    copy:
      "Use countdown, recording, saving, and summary as island-native states instead of detached recorder windows.",
    icon: <MonitorPlay className="size-5" />,
  },
  {
    title: "Studio",
    copy:
      "Background removal, watermark cleanup, and image edits stay on the island and reopen into the correct surface.",
    icon: <WandSparkles className="size-5" />,
  },
  {
    title: "Files",
    copy:
      "Recent artifacts are resumable. The stack reopens the right file workflow instead of dropping you into a dashboard maze.",
    icon: <FolderOpen className="size-5" />,
  },
  {
    title: "NetEase",
    copy:
      "Search, playback, and account connection live inside the same stack as the rest of the island capabilities.",
    icon: <Music4 className="size-5" />,
  },
  {
    title: "Focus",
    copy:
      "Pomodoro is a calm island state with next actions and AI handoff, not a separate productivity mini-app.",
    icon: <Clock3 className="size-5" />,
  },
  {
    title: "File-first AI handoff",
    copy:
      "Generated reports, transcripts, and captures materialize as files first, then continue through AI with explicit user intent.",
    icon: <FileStack className="size-5" />,
  },
  {
    title: "Self-hosted stack",
    copy:
      "The public site, dashboard, native island, and optional local infra all ship in one reproducible repo.",
    icon: <Server className="size-5" />,
  },
  {
    title: "BYOK providers",
    copy:
      "No project account is required. Use your own models, gateways, storage, and speech or video services.",
    icon: <ShieldCheck className="size-5" />,
  },
];

const problemRows = [
  {
    without:
      "You keep bouncing between recorder windows, dashboards, and tool pages just to finish one small task.",
    with:
      "Ark keeps the flow on the island so the next useful action is always one surface away.",
  },
  {
    without:
      "Audio, screenshots, and edits turn into dead files that still need manual cleanup, naming, and follow-up.",
    with:
      "Captures and edits flow directly into files, transcripts, markdown reports, and AI handoff.",
  },
  {
    without:
      "Your desktop assistant looks polished, but the real work still happens somewhere else.",
    with:
      "The island itself becomes the execution surface for recording, editing, playback, focus, and file resumption.",
  },
  {
    without:
      "Open-source release work turns into an internal cleanup project because docs, envs, and links are not public-safe.",
    with:
      "Ark ships with BYOK env examples, GitHub community files, self-hosting docs, and a public landing page out of the box.",
  },
];

const specialRows = [
  {
    label: "Surface-native orchestration",
    copy:
      "Ark models the island as the product surface, not as a notification shell attached to a dashboard later.",
  },
  {
    label: "File-first state transitions",
    copy:
      "Reports, transcripts, captures, and edits become explicit artifacts that can be reopened, downloaded, or sent back into AI.",
  },
  {
    label: "Resumable local state",
    copy:
      "The stack can reopen music, files, studio, focus, and recent results with the right priority instead of guessing from stale state.",
  },
  {
    label: "Provider portability",
    copy:
      "OpenAI-compatible chat, Gemini video analysis, Volcengine ASR, and local infra stay configurable without changing the public contract.",
  },
  {
    label: "Native + web in one repo",
    copy:
      "Rust island runtime, Next.js dashboard, self-hosting docs, and optional infra are versioned together as one product.",
  },
  {
    label: "Public-safe release posture",
    copy:
      "The repo is meant to be pushed as-is: license, templates, CI, docs, source links, and no bundled project secrets.",
  },
];

const boundaryRows = [
  {
    title: "Not a generic widget gallery.",
    copy:
      "The goal is not to showcase mini-components. The goal is to make the island itself the place where workflows continue.",
  },
  {
    title: "Not a hosted-only SaaS shell.",
    copy:
      "Ark is designed to be forked, self-hosted, and BYOK. Public copy cannot rely on our private infra to make sense.",
  },
  {
    title: "Not dashboard-first.",
    copy:
      "The dashboard exists, but the product story starts from the island and radiates outward into files, tools, and docs.",
  },
  {
    title: "Not a single narrow tool.",
    copy:
      "Capture, editing, playback, files, focus, and AI handoff all belong to the same surface system.",
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

const faqs = [
  {
    question: "What does a typical Ark setup look like?",
    answer:
      "The public site and dashboard run from Next.js, the island runtime runs locally on Windows, and optional Compose services add durable state and artifacts.",
  },
  {
    question: "Do I need Ark-hosted accounts or project keys?",
    answer:
      "No. The repo is BYOK. You bring your own model, speech, video, or storage providers and keep secrets in your own environment.",
  },
  {
    question: "Can I use just the website or just the island?",
    answer:
      "Yes. The architecture is modular. You can run the website alone, the website plus local infra, or the full site-plus-native-island stack.",
  },
  {
    question: "Why not just open a dashboard or a recorder app?",
    answer:
      "Because Ark is optimized around fewer jumps. The point is to keep capture, AI, files, and resume actions on the smallest useful surface.",
  },
];

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
      {children}
    </p>
  );
}

function SurfaceCard({
  label,
  title,
  detail,
  chip,
  accent,
}: {
  label: string;
  title: string;
  detail: string;
  chip: string;
  accent: string;
}) {
  return (
    <article className="rounded-[2rem] border border-black/8 bg-[#0b0b0d] p-4 text-white shadow-[0_30px_90px_rgba(15,23,42,0.12)]">
      <div className="rounded-[1.5rem] border border-white/8 bg-black px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`size-2.5 rounded-full ${accent}`} />
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                island surface
              </div>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/80">
            {chip}
          </div>
        </div>
        <div className="mt-5">
          <div className="text-lg font-semibold tracking-[-0.03em]">{title}</div>
          <div className="mt-2 text-sm leading-7 text-white/62">{detail}</div>
        </div>
        <div className="mt-5 h-1.5 rounded-full bg-white/8">
          <div className="h-full w-2/3 rounded-full bg-white/80" />
        </div>
      </div>
    </article>
  );
}

function FeatureCard({
  title,
  copy,
  icon,
}: {
  title: string;
  copy: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-[1.8rem] border border-black/8 bg-white p-5">
      <div className="inline-flex size-10 items-center justify-center rounded-2xl border border-black/8 bg-[#f7f3ea]">
        {icon}
      </div>
      <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-neutral-950">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-7 text-neutral-600">{copy}</p>
    </article>
  );
}

function ComparisonTable({
  title,
  rows,
  leftLabel,
  rightLabel,
}: {
  title: string;
  rows: Array<{ without: string; with: string }>;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
      <SectionEyebrow>{title}</SectionEyebrow>
      <div className="mt-6 overflow-hidden rounded-[2rem] border border-black/8 bg-white">
        <div className="grid border-b border-black/8 bg-[#f7f3ea] text-xs uppercase tracking-[0.22em] text-neutral-500 md:grid-cols-[1fr_1fr]">
          <div className="px-5 py-4">{leftLabel}</div>
          <div className="border-t border-black/8 px-5 py-4 md:border-l md:border-t-0">
            {rightLabel}
          </div>
        </div>
        {rows.map((row) => (
          <div
            key={`${row.without}-${row.with}`}
            className="grid text-sm leading-7 md:grid-cols-[1fr_1fr]"
          >
            <div className="px-5 py-5 text-neutral-600">{row.without}</div>
            <div className="border-t border-black/8 px-5 py-5 text-neutral-950 md:border-l md:border-t-0">
              {row.with}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f6f2e8] text-neutral-950">
      <div className="h-3 bg-[linear-gradient(90deg,#6ed7ff_0%,#c6f36d_28%,#ffb867_58%,#ff84d4_100%)]" />

      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl border border-black/8 bg-white">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">{appConfig.name}</div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
              Open-source Dynamic Island
            </div>
          </div>
        </div>

        <nav className="hidden items-center gap-5 text-sm text-neutral-600 md:flex">
          <Link href="#features" className="transition hover:text-black">
            Features
          </Link>
          <Link href="#quickstart" className="transition hover:text-black">
            Quickstart
          </Link>
          <Link href="/open-source" className="transition hover:text-black">
            Docs
          </Link>
          <Link
            href={appConfig.links.source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-black transition hover:bg-black hover:text-white"
          >
            <Github className="size-4" />
            GitHub
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-18 pt-6 lg:px-10 lg:pb-24 lg:pt-10">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] uppercase tracking-[0.26em] text-neutral-600">
            <Command className="size-3.5" />
            Open-source orchestration for island-native workflows
          </div>
          <h1 className="mt-7 max-w-5xl text-5xl font-semibold tracking-[-0.07em] text-neutral-950 sm:text-6xl lg:text-7xl">
            Manage workflows, not windows.
          </h1>
          <p className="mt-6 text-2xl font-medium tracking-[-0.04em] text-neutral-700">
            If a dashboard is a workspace, Ark is the surface.
          </p>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-neutral-600">
            Ark is a public, self-hosted stack that turns the Dynamic Island into
            a real execution surface for capture, files, editing, music, focus,
            and AI handoff. The site, dashboard, native runtime, and optional
            local infra all ship in one repo.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="#quickstart"
              className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
            >
              Quickstart
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
            >
              Open dashboard
            </Link>
            <Link
              href={appConfig.links.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-neutral-700 transition hover:bg-white"
            >
              View source
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.22em] text-neutral-500">
          <span>Works with</span>
          {worksWith.map((item) => (
            <span
              key={item}
              className="rounded-full border border-black/10 bg-white px-3 py-2"
            >
              {item}
            </span>
          ))}
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="overflow-hidden rounded-[2rem] border border-black/8 bg-[#0c0d10] text-white shadow-[0_30px_90px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.24em] text-white/44">
              <span>Quickstart</span>
              <span>Public + self-hosted</span>
            </div>
            <div className="space-y-3 px-5 py-5 font-mono text-[13px] leading-7">
              {quickstart.map((line) => (
                <div key={line} className="rounded-2xl bg-white/6 px-4 py-3">
                  {line}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            {heroSurfaces.map((surface) => (
              <SurfaceCard key={surface.label} {...surface} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-black/8 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
          <SectionEyebrow>What is Ark?</SectionEyebrow>
          <h2 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
            Ark is the control surface for dynamic-island-first productivity.
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-8 text-neutral-600">
            It looks like a minimal desktop island, but under the hood it
            carries native capture, resumable files, self-hosted web control,
            tool routing, and AI handoff. The point is not decoration. The point
            is to let work continue from the smallest useful surface.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {orchestrationSteps.map((item) => (
              <article
                key={item.step}
                className="rounded-[1.8rem] border border-black/8 bg-[#f7f3ea] p-5"
              >
                <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">
                  {item.step}
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-neutral-600">
                  {item.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
        <SectionEyebrow>Ark is right for you if</SectionEyebrow>
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-4">
            {fitList.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-[1.6rem] border border-black/8 bg-white px-5 py-4"
              >
                <CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-600" />
                <p className="text-sm leading-7 text-neutral-700">{item}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[2rem] border border-black/8 bg-[#111214] p-6 text-white">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/8">
              <Bot className="size-5" />
            </div>
            <h3 className="mt-6 text-2xl font-semibold tracking-[-0.03em]">
              The island is the product.
            </h3>
            <p className="mt-4 text-sm leading-7 text-white/70">
              Ark is not trying to make a dashboard prettier. It is trying to
              reduce decision cost. The user should see what matters, act once,
              and keep moving.
            </p>
            <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/40">
                Design thesis
              </div>
              <div className="mt-3 text-lg font-medium">
                Smaller surface, lower friction, faster handoff.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-y border-black/8 bg-[#ece7dc]">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
          <SectionEyebrow>Features</SectionEyebrow>
          <h2 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
            Island-native workflows, public-safe release posture, one repo.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featureCards.map((card) => (
              <FeatureCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      </section>

      <ComparisonTable
        title="Problems Ark solves"
        rows={problemRows}
        leftLabel="Without Ark"
        rightLabel="With Ark"
      />

      <section className="border-y border-black/8 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
          <SectionEyebrow>Why Ark is special</SectionEyebrow>
          <div className="mt-6 overflow-hidden rounded-[2rem] border border-black/8">
            {specialRows.map((row, index) => (
              <div
                key={row.label}
                className={`grid gap-4 bg-white px-5 py-5 md:grid-cols-[240px_1fr] ${
                  index === 0 ? "" : "border-t border-black/8"
                }`}
              >
                <div className="text-sm font-semibold text-neutral-950">
                  {row.label}
                </div>
                <div className="text-sm leading-7 text-neutral-600">
                  {row.copy}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
        <SectionEyebrow>What Ark is not</SectionEyebrow>
        <div className="mt-6 overflow-hidden rounded-[2rem] border border-black/8 bg-white">
          {boundaryRows.map((row, index) => (
            <div
              key={row.title}
              className={`grid gap-4 px-5 py-5 md:grid-cols-[240px_1fr] ${
                index === 0 ? "" : "border-t border-black/8"
              }`}
            >
              <div className="text-sm font-semibold text-neutral-950">
                {row.title}
              </div>
              <div className="text-sm leading-7 text-neutral-600">
                {row.copy}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="quickstart" className="border-y border-black/8 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div>
            <SectionEyebrow>Quickstart</SectionEyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              Open source. Self-hosted. No Ark account required.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-neutral-600">
              Clone the repo, add your own provider keys, start the web layer,
              and run the native island on Windows. The public contract is BYOK
              and the examples stay placeholder-only.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <article className="rounded-[1.6rem] border border-black/8 bg-[#f7f3ea] p-5">
                <div className="text-sm font-semibold">Web + dashboard</div>
                <p className="mt-2 text-sm leading-7 text-neutral-600">
                  Next.js public site, dashboard routes, API routes, and docs
                  all run from the same app package.
                </p>
              </article>
              <article className="rounded-[1.6rem] border border-black/8 bg-[#f7f3ea] p-5">
                <div className="text-sm font-semibold">Native island</div>
                <p className="mt-2 text-sm leading-7 text-neutral-600">
                  Rust-native Windows runtime powers capture, files, music,
                  focus, studio, and resumable stack behavior.
                </p>
              </article>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-black/8 bg-[#0c0d10] text-white">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.22em] text-white/44">
              <span>Terminal</span>
              <span>7 commands</span>
            </div>
            <div className="space-y-3 px-5 py-5 font-mono text-[13px] leading-7">
              {quickstart.map((line) => (
                <div key={line} className="rounded-2xl bg-white/6 px-4 py-3">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
        <SectionEyebrow>FAQ</SectionEyebrow>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {faqs.map((item) => (
            <article
              key={item.question}
              className="rounded-[1.8rem] border border-black/8 bg-white p-6"
            >
              <div className="text-lg font-semibold tracking-[-0.03em]">
                {item.question}
              </div>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                {item.answer}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#101114] py-20 text-white">
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <SectionEyebrow>
                <span className="text-white/45">Public release posture</span>
              </SectionEyebrow>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
                Publishable without the cleanup sprint.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-white/68">
                Ark ships with license, community files, CI, public-safe env
                examples, self-hosting docs, and a homepage that leads with the
                product. That is the baseline now.
              </p>
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
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
              >
                Open docs
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <article className="rounded-[1.7rem] border border-white/10 bg-white/5 p-5">
              <FileText className="size-5 text-white/78" />
              <div className="mt-4 text-lg font-semibold">Placeholder-only envs</div>
              <p className="mt-2 text-sm leading-7 text-white/62">
                Public examples stay secret-free. Bring your own providers and
                keep sensitive values in your own environment.
              </p>
            </article>
            <article className="rounded-[1.7rem] border border-white/10 bg-white/5 p-5">
              <Server className="size-5 text-white/78" />
              <div className="mt-4 text-lg font-semibold">Self-hosted infra</div>
              <p className="mt-2 text-sm leading-7 text-white/62">
                PostgreSQL, Redis, MinIO, and executor wiring are documented and
                optional, not hidden prerequisites.
              </p>
            </article>
            <article className="rounded-[1.7rem] border border-white/10 bg-white/5 p-5">
              <Github className="size-5 text-white/78" />
              <div className="mt-4 text-lg font-semibold">GitHub-ready shell</div>
              <p className="mt-2 text-sm leading-7 text-white/62">
                README, license, templates, CI, docs, and public site are ready
                to push without a private cleanup pass.
              </p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
