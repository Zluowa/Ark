import Link from "next/link";
import type { ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Command,
  Github,
  Sparkles,
} from "lucide-react";
import { appConfig } from "@/lib/config/app-config";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-ark-display",
});

const flows = [
  {
    label: "Audio Notes",
    title: "Speak -> mp3 -> text -> Ask AI",
    copy:
      "Keep the recording as a file, convert it to text, then continue through the normal AI input instead of a dead export flow.",
    media: "/demo/audio-notes-flow.mp4",
  },
  {
    label: "Studio",
    title: "Edit in place, preview in place",
    copy:
      "Remove a watermark or background on the island, then land back on the correct result surface without opening another tool shell.",
    media: "/demo/studio-watermark-flow.mp4",
  },
  {
    label: "NetEase",
    title: "Connect, search, play",
    copy:
      "Auth, results, playback, and resume live in the same stack as the rest of the island capabilities.",
    media: "/demo/netease-flow.mp4",
  },
  {
    label: "Focus",
    title: "Start work, finish, hand off",
    copy:
      "Run a focus block quietly, expand only when needed, then reopen the next action when it ends.",
    media: "/demo/focus-flow.mp4",
  },
];

const quickstart = [
  "pnpm onboard --yes --profile full",
  "pnpm --dir app dev",
  "cargo run --manifest-path desktop/Cargo.toml -p omniagent-island",
  "open http://127.0.0.1:3010",
];

const fit = [
  "You want the Dynamic Island to be a real workflow surface, not just a status ornament.",
  "You want fewer jumps between recorder windows, dashboards, and file managers.",
  "You want a public repo you can fork and self-host with BYOK providers.",
];

const facts = ["Rust-native", "BYOK", "Self-hosted", "Agent-ready"];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
      {children}
    </p>
  );
}

function FlowCard({
  label,
  title,
  copy,
  media,
}: {
  label: string;
  title: string;
  copy: string;
  media: string;
}) {
  return (
    <article className="overflow-hidden rounded-[2rem] border border-black/8 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
      <div className="border-b border-black/8 bg-[#0a0b0f] p-4">
        <div className="overflow-hidden rounded-[1.5rem] border border-white/8 bg-black">
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="aspect-[16/10] w-full object-cover"
            src={media}
          />
        </div>
      </div>
      <div className="p-5">
        <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">
          {label}
        </div>
        <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-neutral-600">{copy}</p>
      </div>
    </article>
  );
}

export default function Home() {
  return (
    <main
      className={`${display.variable} min-h-screen bg-[#f6f2e8] text-neutral-950`}
    >
      <div className="h-2 bg-[linear-gradient(90deg,#77d9ff_0%,#d4f56f_28%,#ffbe77_58%,#ff8bd0_100%)]" />

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
          <Link href="#flows" className="transition hover:text-black">
            Flows
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

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-6 lg:px-10 lg:pt-10">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] uppercase tracking-[0.26em] text-neutral-600">
              <Command className="size-3.5" />
              Open-source island-native orchestration
            </div>
            <h1 className="mt-7 font-[family:var(--font-ark-display)] text-5xl font-semibold tracking-[-0.08em] sm:text-6xl lg:text-7xl">
              The Dynamic Island,
              <br />
              made useful.
            </h1>
            <p className="mt-6 max-w-2xl text-xl leading-9 text-neutral-700">
              Capture, edit, resume, and hand off work from the smallest useful
              surface.
            </p>
            <p className="mt-5 max-w-2xl text-base leading-8 text-neutral-600">
              Ark turns the island into a real workflow system for audio notes,
              screen recording, Studio edits, files, NetEase playback, focus,
              and AI handoff.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="#quickstart"
                className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                Start self-hosting
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="#flows"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
              >
                Watch the full tour
              </Link>
              <Link
                href={appConfig.links.source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-neutral-700 transition hover:bg-white"
              >
                View GitHub
                <ArrowUpRight className="size-4" />
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.24em] text-neutral-500">
              {facts.map((item) => (
                <div
                  key={item}
                  className="rounded-full border border-black/10 bg-white px-4 py-2"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <article className="overflow-hidden rounded-[2.4rem] border border-black/8 bg-[#0b0c10] p-5 text-white shadow-[0_28px_90px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between px-1 py-1 text-[11px] uppercase tracking-[0.24em] text-white/42">
              <span>Island preview</span>
              <span>Real product surfaces</span>
            </div>
            <div className="mt-3 overflow-hidden rounded-[2rem] border border-white/8 bg-black">
              <img
                src="/demo/studio-watermark-flow.gif"
                alt="Ark island studio preview"
                className="aspect-[16/10] w-full object-cover"
              />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                  Audio Notes
                </div>
                <div className="mt-2 text-sm text-white/80">
                  mp3 -&gt; text -&gt; Ask AI
                </div>
              </div>
              <div className="rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                  NetEase
                </div>
                <div className="mt-2 text-sm text-white/80">connect, search, play</div>
              </div>
              <div className="rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/42">
                  Focus
                </div>
                <div className="mt-2 text-sm text-white/80">finish, log, hand off</div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="border-y border-black/8 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-18 lg:grid-cols-[1fr_1fr] lg:px-10">
          <div>
            <Eyebrow>Ark is right for you if</Eyebrow>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              You want the island to do real work, not just announce it.
            </h2>
          </div>
          <div className="grid gap-4">
            {fit.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-[1.6rem] border border-black/8 bg-[#f7f3ea] px-5 py-4"
              >
                <CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-600" />
                <p className="text-sm leading-7 text-neutral-700">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="flows"
        className="mx-auto max-w-6xl px-6 py-20 lg:px-10"
      >
        <Eyebrow>Real flows</Eyebrow>
        <div className="mt-4 grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <div>
            <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              Real island flows, not mock cards.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-neutral-600">
              The public homepage should show the same product story the runtime
              actually supports: capture, transform, hand off, and resume.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link
              href="/open-source"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
            >
              Deployment docs
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-neutral-700 transition hover:bg-white"
            >
              Open dashboard
            </Link>
          </div>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {flows.map((flow) => (
            <FlowCard key={flow.label} {...flow} />
          ))}
        </div>
      </section>

      <section className="border-y border-black/8 bg-white" id="quickstart">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div>
            <Eyebrow>Quickstart</Eyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              Fork it. Bring your own keys. Start from one public contract.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-neutral-600">
              Ark is open source, self-hosted, and BYOK. The onboarding flow is
              shaped so a human or coding agent can start from the same public
              checklist.
            </p>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-black/8 bg-[#0c0d10] text-white">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.22em] text-white/44">
              <span>Quickstart</span>
              <span>Agent-friendly</span>
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
        <Eyebrow>Public release posture</Eyebrow>
        <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h2 className="text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              Publishable without the cleanup sprint.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-neutral-600">
              Demo media, docs, env examples, and GitHub-facing copy are all
              shaped to survive cold public traffic.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={appConfig.links.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
            >
              <Github className="size-4" />
              View GitHub
            </Link>
            <Link
              href="/open-source"
              className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
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
