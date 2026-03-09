import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Command,
  FileStack,
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

const stats = [
  ["Native island", "Rust runtime", "Audio, screen, Studio, files, music, focus."],
  ["Public contract", "BYOK + self-hosted", "Forkable without Ark-hosted accounts."],
  ["Agent deploy", "One onboarding path", "`pnpm onboard --yes --profile full`."],
  ["Demo media", "Real proof assets", "Homepage videos come from native proof runs."],
];

const heroCards = [
  ["Audio Notes", "Speak -> mp3 -> text", "To Text"],
  ["Screen Record", "Capture -> report.md", "Saving"],
  ["Studio", "Edit without leaving", "Apply"],
];

const flows = [
  [
    "Audio Notes",
    "File-first capture",
    "Record audio, keep the mp3, convert to text, then reopen Ask AI with context attached.",
    "/demo/audio-notes-flow.mp4",
  ],
  [
    "Studio",
    "Edit and land back on preview",
    "Remove a watermark or background in place and stay inside the island result loop.",
    "/demo/studio-watermark-flow.mp4",
  ],
  [
    "NetEase",
    "Auth, search, playback",
    "Connect the account and stay in the same stack as the rest of the island tools.",
    "/demo/netease-flow.mp4",
  ],
  [
    "Focus",
    "Finish work, hand off to AI",
    "Run a focus block quietly, expand when needed, then reopen the next action when it ends.",
    "/demo/focus-flow.mp4",
  ],
];

const fullTour = {
  title: "One product story, one surface system",
  copy:
    "Show the actual island loop before asking people to deploy it: capture, materialize a real artifact, reopen the next action, then hand it back to AI, files, or playback.",
  caption: "Audio Notes -> Studio -> NetEase -> Focus",
};

const fitList = [
  "You want the Dynamic Island to be a real workflow surface.",
  "You want fewer window jumps for capture, files, and AI handoff.",
  "You want a public repo you can fork and self-host with BYOK providers.",
  "You want one system for island, dashboard, files, and resume flows.",
];

const features: Array<{ title: string; copy: string; icon: ReactNode }> = [
  { title: "Audio Notes", copy: "Record, convert to text, then continue through normal AI input.", icon: <Mic className="size-5" /> },
  { title: "Screen Record", copy: "Countdown, recording, saving, and report handoff as island-native states.", icon: <MonitorPlay className="size-5" /> },
  { title: "Studio", copy: "Background removal and watermark cleanup that stay on the island.", icon: <WandSparkles className="size-5" /> },
  { title: "Files", copy: "Recent artifacts are resumable instead of dead exports.", icon: <FolderOpen className="size-5" /> },
  { title: "NetEase", copy: "Search and playback inside the same stack.", icon: <Music4 className="size-5" /> },
  { title: "Focus", copy: "Pomodoro as a calm island state, not another mini-app.", icon: <Clock3 className="size-5" /> },
  { title: "File-first AI", copy: "Reports, transcripts, and captures become explicit artifacts.", icon: <FileStack className="size-5" /> },
  { title: "Self-hosted stack", copy: "Website, dashboard, native runtime, and docs live in one repo.", icon: <Server className="size-5" /> },
  { title: "BYOK providers", copy: "Use your own models, speech, video, and storage services.", icon: <ShieldCheck className="size-5" /> },
];

const quickstart = [
  "pnpm onboard --yes --profile full",
  "pnpm --dir app dev",
  "cargo run --manifest-path desktop/Cargo.toml -p omniagent-island",
  "open http://127.0.0.1:3010",
];

const faqs = [
  ["What is the smallest setup?", "Run the web app alone first, then add the native island or local infra when you want the full product surface."],
  ["Do I need Ark-hosted keys?", "No. The repo is BYOK. Bring your own model and provider credentials."],
  ["Can I use just the website or just the island?", "Yes. The stack is modular, but the product story is strongest when they run together."],
  ["Why not just open a dashboard?", "Because Ark is optimized around fewer jumps. The point is to keep the next action close."],
];

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">{children}</p>;
}

function StatCard({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <article className="rounded-[1.7rem] border border-black/8 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</div>
      <p className="mt-3 text-sm leading-7 text-neutral-600">{copy}</p>
    </article>
  );
}

function FlowCard({ label, title, copy, media }: { label: string; title: string; copy: string; media: string }) {
  return (
    <article className="overflow-hidden rounded-[2rem] border border-black/8 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.08)]">
      <div className="border-b border-black/8 bg-[#0a0b0f] p-4">
        <div className="overflow-hidden rounded-[1.6rem] border border-white/8 bg-black">
          <video autoPlay loop muted playsInline preload="metadata" className="aspect-[16/10] w-full bg-black object-cover" src={media} />
        </div>
      </div>
      <div className="p-5">
        <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">{label}</div>
        <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-neutral-600">{copy}</p>
        <Link href={media} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-neutral-950">
          Watch MP4
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
    </article>
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
            <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">Open-source Dynamic Island</div>
          </div>
        </div>
        <nav className="hidden items-center gap-5 text-sm text-neutral-600 md:flex">
          <Link href="#flows" className="transition hover:text-black">Flows</Link>
          <Link href="#features" className="transition hover:text-black">Features</Link>
          <Link href="#quickstart" className="transition hover:text-black">Quickstart</Link>
          <Link href="/open-source" className="transition hover:text-black">Docs</Link>
          <Link href={appConfig.links.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-black transition hover:bg-black hover:text-white">
            <Github className="size-4" />
            GitHub
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-6 lg:px-10 lg:pt-10">
        <div className="grid gap-12 lg:grid-cols-[0.92fr_1.08fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-[11px] uppercase tracking-[0.26em] text-neutral-600">
              <Command className="size-3.5" />
              Open-source island-native orchestration
            </div>
            <h1 className="mt-7 text-5xl font-semibold tracking-[-0.08em] sm:text-6xl lg:text-7xl">The Dynamic Island, made useful.</h1>
            <p className="mt-6 max-w-3xl text-2xl font-medium tracking-[-0.05em] text-neutral-700">
              Capture, edit, resume, and hand off work from the smallest useful surface.
            </p>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-neutral-600">
              Ark turns the island into a real workflow system for audio notes, screen recording, Studio edits, files, NetEase playback, focus, and AI handoff.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-neutral-500">
              The point is not to make the dashboard prettier. The point is to make the next useful action happen before the user loses context.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="#quickstart" className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800">
                Start self-hosting
                <ArrowRight className="size-4" />
              </Link>
              <Link href="#flows" className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black">
                Watch the island tour
              </Link>
              <Link href={appConfig.links.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-neutral-700 transition hover:bg-white">
                View GitHub
                <ArrowUpRight className="size-4" />
              </Link>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {stats.map(([label, value, copy]) => (
                <StatCard key={label} label={label} value={value} copy={copy} />
              ))}
            </div>
          </div>

          <div className="grid gap-5">
            <article className="overflow-hidden rounded-[2.2rem] border border-black/8 bg-[#0b0c10] p-4 text-white shadow-[0_32px_90px_rgba(15,23,42,0.12)]">
              <div className="flex items-center justify-between px-2 py-2 text-[11px] uppercase tracking-[0.24em] text-white/42">
                <span>Full island tour</span>
                <span>Real proof media</span>
              </div>
              <div className="overflow-hidden rounded-[1.8rem] border border-white/8 bg-black">
                <video autoPlay loop muted playsInline preload="metadata" className="aspect-[16/10] w-full bg-black object-cover" src="/demo/full-island-tour.mp4" />
              </div>
              <div className="grid gap-4 px-2 pb-2 pt-5 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.05em]">{fullTour.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-white/66">{fullTour.copy}</p>
                </div>
                <div className="rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4 text-sm leading-7 text-white/78">{fullTour.caption}</div>
              </div>
            </article>
            <div className="grid gap-4 md:grid-cols-3">
              {heroCards.map(([label, title, chip], index) => (
                <article key={label} className="rounded-[2rem] border border-black/8 bg-[#0b0b0d] p-4 text-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
                  <div className="rounded-[1.5rem] border border-white/8 bg-black px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className={`size-2.5 rounded-full ${index === 0 ? "bg-cyan-300" : index === 1 ? "bg-amber-300" : "bg-fuchsia-300"}`} />
                        <div>
                          <div className="text-sm font-medium">{label}</div>
                          <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">island surface</div>
                        </div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-white/80">{chip}</div>
                    </div>
                    <div className="mt-5 text-lg font-semibold tracking-[-0.03em]">{title}</div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-black/8 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
          <div>
            <SectionEyebrow>Ark is right for you if</SectionEyebrow>
            <h2 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              You want the island to do real work, not just announce it.
            </h2>
            <div className="mt-8 grid gap-4">
              {fitList.map((item) => (
                <div key={item} className="flex gap-3 rounded-[1.6rem] border border-black/8 bg-[#f7f3ea] px-5 py-4">
                  <CheckCircle2 className="mt-1 size-5 shrink-0 text-emerald-600" />
                  <p className="text-sm leading-7 text-neutral-700">{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4">
            {[
              ["Stop opening another tool window.", "Ark keeps the smallest useful surface alive so the user can act once and keep moving."],
              ["Treat files as workflow state.", "mp3, transcripts, reports, and edited images stay resumable instead of becoming leftovers."],
              ["Ship a forkable product.", "Homepage, README, docs, env examples, and media are tuned for cold GitHub traffic."],
            ].map(([title, copy]) => (
              <article key={title} className="rounded-[1.9rem] border border-black/8 bg-[#111214] p-6 text-white">
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Why Ark lands</div>
                <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em]">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-white/68">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="flows" className="border-y border-black/8 bg-[linear-gradient(180deg,#ffffff_0%,#f1ede4_100%)]">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
            <div>
              <SectionEyebrow>Watch Ark work</SectionEyebrow>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">Real island flows, not mock cards.</h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-neutral-600">
                The homepage and README should show the same product story the runtime actually supports: capture, transform, hand off, and resume.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Link href="/open-source" className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black">
                Deployment docs
                <ArrowRight className="size-4" />
              </Link>
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full border border-black/10 px-5 py-3 text-sm font-medium text-neutral-700 transition hover:bg-white">
                Open dashboard
              </Link>
            </div>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {flows.map(([label, title, copy, media]) => (
              <FlowCard key={label} label={label} title={title} copy={copy} media={media} />
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="border-y border-black/8 bg-[#ece7dc]">
        <div className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
          <SectionEyebrow>Features</SectionEyebrow>
          <h2 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">The whole stack is built around keeping the island useful.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => (
              <article key={feature.title} className="rounded-[1.8rem] border border-black/8 bg-white p-5">
                <div className="inline-flex size-10 items-center justify-center rounded-2xl border border-black/8 bg-[#f7f3ea]">{feature.icon}</div>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em]">{feature.title}</h3>
                <p className="mt-3 text-sm leading-7 text-neutral-600">{feature.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
        <SectionEyebrow>Problems Ark solves</SectionEyebrow>
        <div className="mt-6 overflow-hidden rounded-[2rem] border border-black/8 bg-white">
          <div className="grid border-b border-black/8 bg-[#f7f3ea] text-xs uppercase tracking-[0.22em] text-neutral-500 md:grid-cols-[1fr_1fr]">
            <div className="px-5 py-4">Without Ark</div>
            <div className="border-t border-black/8 px-5 py-4 md:border-l md:border-t-0">With Ark</div>
          </div>
          {[
            ...[
              ["Recorder windows, dashboards, and tool pages for one task.", "The next useful action stays one surface away."],
              ["Audio and screenshots turn into dead files.", "Captures flow into transcripts, reports, and AI handoff."],
              ["The island looks polished but work happens elsewhere.", "The island becomes the execution surface."],
              ["Open-source release needs a cleanup sprint first.", "Docs, envs, and landing pages are public-safe by default."],
            ],
          ].map(([left, right]) => (
            <div key={left} className="grid text-sm leading-7 md:grid-cols-[1fr_1fr]">
              <div className="px-5 py-5 text-neutral-600">{left}</div>
              <div className="border-t border-black/8 px-5 py-5 text-neutral-950 md:border-l md:border-t-0">{right}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="quickstart" className="border-y border-black/8 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div>
            <SectionEyebrow>Quickstart</SectionEyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">Fork it. Bring your own keys. Start from one public contract.</h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-neutral-600">
              Ark is open source, self-hosted, and BYOK. The onboarding flow is shaped so a human or coding agent can start from the same public checklist.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <article className="rounded-[1.6rem] border border-black/8 bg-[#f7f3ea] p-5">
                <div className="text-sm font-semibold">Web + dashboard</div>
                <p className="mt-2 text-sm leading-7 text-neutral-600">Next.js powers the public site, dashboard routes, APIs, and docs from one app package.</p>
              </article>
              <article className="rounded-[1.6rem] border border-black/8 bg-[#f7f3ea] p-5">
                <div className="text-sm font-semibold">Native island</div>
                <p className="mt-2 text-sm leading-7 text-neutral-600">The Rust-native runtime handles capture, files, music, focus, Studio, and stack resume locally.</p>
              </article>
            </div>
          </div>
          <div className="overflow-hidden rounded-[2rem] border border-black/8 bg-[#0c0d10] text-white">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.22em] text-white/44">
              <span>Quickstart</span>
              <span>Agent-friendly</span>
            </div>
            <div className="space-y-3 px-5 py-5 font-mono text-[13px] leading-7">
              {quickstart.map((line) => (
                <div key={line} className="rounded-2xl bg-white/6 px-4 py-3">{line}</div>
              ))}
            </div>
            <div className="border-t border-white/8 px-5 py-5 text-sm leading-7 text-white/68">
              Start with one onboarding command, fill only your own env values, then validate the public site, dashboard, and island runtime in one pass.
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:px-10">
        <SectionEyebrow>FAQ</SectionEyebrow>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {faqs.map(([question, answer]) => (
            <article key={question} className="rounded-[1.8rem] border border-black/8 bg-white p-6">
              <div className="text-lg font-semibold tracking-[-0.03em]">{question}</div>
              <p className="mt-3 text-sm leading-7 text-neutral-600">{answer}</p>
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
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">Publishable without the cleanup sprint.</h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-white/68">
                Ark ships with demo media, community files, CI, public-safe env examples, self-hosting docs, and a homepage that leads with the product.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={appConfig.links.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10">
                <Github className="size-4" />
                View GitHub
              </Link>
              <Link href="/open-source" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200">
                Open docs
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
