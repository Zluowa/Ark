import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Command,
  FileText,
  FolderOpen,
  Github,
  ImageIcon,
  KeyRound,
  Layers3,
  Mic,
  Monitor,
  Music4,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { CopyCommandButton } from "@/components/marketing/copy-command-button";
import { appConfig } from "@/lib/config/app-config";
import { getPlatformContract } from "@/lib/server/platform-contract";

const quickstartCommand = "pnpm onboard --yes --profile full";

const steps = [
  {
    number: "01",
    title: "Capture the signal.",
    detail:
      "Start with audio, screen, files, Studio, NetEase, or Focus from the island instead of detouring to a utility window first.",
  },
  {
    number: "02",
    title: "Continue in place.",
    detail:
      "Artifacts stay file-first. Recordings become mp3 and text, image edits reopen on the right preview, and playback stays in the same stack.",
  },
  {
    number: "03",
    title: "Hand off with context.",
    detail:
      "Reopen Ask AI, resume the stack, download reports, or return to playback without rebuilding context from scratch.",
  },
];

const features: Array<{
  title: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    title: "Audio Notes",
    detail:
      "Record, save the mp3, convert to text, then reopen Ask AI with the transcript attached.",
    icon: Mic,
  },
  {
    title: "Screen Record",
    detail:
      "Countdown, recording, saving, and summary all live as island-native states instead of floating recorder chrome.",
    icon: Monitor,
  },
  {
    title: "Studio",
    detail:
      "Background removal, watermark cleanup, and in-place previews stay on the island and return to the right result surface.",
    icon: ImageIcon,
  },
  {
    title: "Files",
    detail:
      "Recent artifacts are resumable, openable, and reusable instead of becoming dead exports buried in a folder.",
    icon: FolderOpen,
  },
  {
    title: "NetEase",
    detail:
      "Connect the account, search tracks, and move straight into playback from the same stack as the rest of the product.",
    icon: Music4,
  },
  {
    title: "Focus",
    detail:
      "Run a calm work block, complete it, and reopen the next AI action without turning the island into a separate productivity app.",
    icon: TimerReset,
  },
  {
    title: "Markdown reports",
    detail:
      "Audio and screen flows can materialize summaries as downloadable files instead of trapping output inside a transient toast.",
    icon: FileText,
  },
  {
    title: "Resumable stack",
    detail:
      "The stack remembers what deserves focus next and reopens the right live surface instead of guessing from stale state.",
    icon: Sparkles,
  },
];

const providers = [
  "OpenAI-compatible",
  "Gemini",
  "Volcengine ASR",
  "NetEase Cloud Music",
  "Rust runtime",
  "Next.js",
  "Docker Compose",
  "BYOK",
];

const stackNodes = [
  "Audio Notes",
  "Screen Record",
  "Studio",
  "Files",
  "NetEase",
  "Focus",
];

const problems = [
  {
    without:
      "You keep bouncing between recorder windows, dashboards, and file managers just to finish one small task.",
    with:
      "Ark keeps the next useful action on the island so capture, edit, playback, and AI handoff feel like one system.",
  },
  {
    without:
      "Audio, screenshots, and edits become dead files that still need naming, cleanup, and manual follow-up.",
    with:
      "Ark turns captures into explicit artifacts, transcripts, and reports that can be reopened or handed to AI in place.",
  },
  {
    without:
      "Desktop assistants look polished in demos, but the real work still happens in bigger tools somewhere else.",
    with:
      "Ark makes the island itself the execution surface for capture, playback, editing, focus, and recent file resumption.",
  },
  {
    without:
      "Open-source release prep becomes a cleanup sprint because docs, demos, and envs are not safe to show publicly.",
    with:
      "Ark ships with public demo media, BYOK env examples, docs, and a homepage that can survive cold traffic as-is.",
  },
];

const underTheHood: Array<{
  title: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    title: "File-first state transitions",
    detail:
      "Captures and edits become real artifacts before they become AI prompts, so handoff stays explicit and debuggable.",
    icon: FileText,
  },
  {
    title: "Resumable local state",
    detail:
      "The stack can reopen recent music, files, Studio edits, focus sessions, and results with actual surface priority.",
    icon: Sparkles,
  },
  {
    title: "Runtime safety for live surfaces",
    detail:
      "Finished image or AI events do not knock active recording or playback surfaces out of the user's hands.",
    icon: Monitor,
  },
  {
    title: "Provider portability",
    detail:
      "Chat, image, speech, and video providers stay configurable without changing the public self-hosting contract.",
    icon: Command,
  },
  {
    title: "Native plus web in one repo",
    detail:
      "Rust runtime, website, dashboard, demo assets, docs, and proof scripts all ship together as one releaseable product.",
    icon: FolderOpen,
  },
  {
    title: "Public-safe release posture",
    detail:
      "The repo can be pushed without leaking project keys, hidden setup steps, or dependencies on private infrastructure.",
    icon: Check,
  },
];

const whatItIsNot = [
  {
    title: "Not a widget gallery.",
    detail:
      "The goal is not to showcase mini-components. The goal is to make the island the place where workflows continue.",
  },
  {
    title: "Not dashboard-first.",
    detail:
      "The dashboard exists, but the product story starts from the island and only expands when the workflow needs more room.",
  },
  {
    title: "Not a hosted-only shell.",
    detail:
      "Ark is self-hosted and BYOK. Public copy cannot rely on private services or project-owned keys to make sense.",
  },
  {
    title: "Not a single narrow utility.",
    detail:
      "Audio capture, screen recording, Studio edits, playback, focus, and file handoff belong to the same surface system.",
  },
  {
    title: "Not a fake demo site.",
    detail:
      "The public story is built from real proof media and real repo paths, not concept renders that collapse on clone.",
  },
];

const faq = [
  {
    question: "What does a typical Ark setup look like?",
    answer:
      "The website and dashboard run from Next.js, the island runtime runs locally on Windows, and optional Compose services add state and artifacts when you need the full stack.",
  },
  {
    question: "Do I need Ark-hosted accounts or project keys?",
    answer:
      "No. Ark is BYOK. You bring your own model, speech, video, or storage providers and keep secrets in your own environment.",
  },
  {
    question: "Can I run the website without the native island?",
    answer:
      "Yes. The website and dashboard can stand alone, then you can add the native island when you want the full workflow surface.",
  },
  {
    question: "What should an agent run first in a new fork?",
    answer:
      "Start with pnpm onboard --dry-run --profile full, fill app/.env.local with your own values, then run the website, the island runtime, build, tests, and UI evidence.",
  },
  {
    question: "Why not just use a dashboard or a recorder app?",
    answer:
      "Because Ark is about fewer jumps. The point is to keep capture, AI, files, playback, and resume actions on the smallest useful surface.",
  },
];

const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "Get started", href: "#get-started" },
      { label: "Quickstart", href: "#quickstart" },
      { label: "Full tour", href: "#how-it-works" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Audio Notes", href: "#features" },
      { label: "Studio", href: "#features" },
      { label: "NetEase", href: "#features" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Developer contract", href: "/developers" },
      { label: "GitHub", href: appConfig.links.source },
      { label: "Docs", href: "/open-source" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Self hosting", href: "/open-source" },
      { label: "License", href: appConfig.links.source },
      { label: "Issues", href: `${appConfig.links.source}/issues` },
    ],
  },
];

function SectionBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[#efebe6] px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-[#1a1a1a]">
      {children}
    </span>
  );
}

function TerminalCard({
  title,
  subtitle,
  command,
  dark = false,
}: {
  title: string;
  subtitle: string;
  command: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[28px] border ${
        dark
          ? "border-white/10 bg-[#101216] text-white"
          : "border-[#ddd6cf] bg-[#16181d] text-white"
      } shadow-[0_24px_80px_rgba(8,15,30,0.12)]`}
    >
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-white/50">
            {title}
          </div>
          <div className="mt-1 text-sm text-white/72">{subtitle}</div>
        </div>
        <CopyCommandButton command={command} />
      </div>
      <div className="px-5 py-5">
        <div className="flex items-center gap-2">
          <span className="font-[family:var(--font-ark-mono)] text-sm text-[#77d9ff]">
            $
          </span>
          <span className="font-[family:var(--font-ark-mono)] text-sm text-white">
            {command}
          </span>
        </div>
      </div>
    </div>
  );
}

type HomeProps = {
  searchParams?: Promise<{
    evidence?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = searchParams ? await searchParams : undefined;
  const evidenceMode = params?.evidence === "1";
  const contract = getPlatformContract();

  return (
    <main
      className="min-h-screen bg-white font-[family:var(--font-ark-sans)] text-[#1a1a1a]"
    >
      <header className="absolute inset-x-0 top-0 z-40 px-4 pt-4">
        <div className="mx-auto flex max-w-[760px] items-center justify-between rounded-full border border-white/15 bg-white/12 px-5 py-3 text-white shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-2xl">
          <div className="flex items-center gap-4">
            <Link
              href="/open-source"
              className="text-sm text-white/78 transition hover:text-white"
            >
              Docs
            </Link>
            <Link
              href="/developers"
              className="text-sm text-white/78 transition hover:text-white"
            >
              Developers
            </Link>
            <Link
              href="#how-it-works"
              className="hidden text-sm text-white/78 transition hover:text-white sm:inline"
            >
              Demo
            </Link>
          </div>

          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <div className="flex size-8 items-center justify-center rounded-full bg-white/16">
              <Sparkles className="size-4" />
            </div>
            Ark
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href={appConfig.links.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/12 px-3 py-1.5 text-sm text-white transition hover:bg-white/18"
            >
              <Github className="size-4" />
              GitHub
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[#161922] text-white">
        <div className="absolute inset-0">
          <video
            autoPlay={!evidenceMode}
            loop={!evidenceMode}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full scale-110 object-cover opacity-28"
            src="/demo/full-island-tour.mp4"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_32%),linear-gradient(180deg,rgba(11,14,20,0.32),rgba(11,14,20,0.88)_64%,#ffffff_100%)]" />
        </div>

        <div className="relative mx-auto flex min-h-[840px] max-w-[1140px] items-end px-6 pb-24 pt-40 lg:px-8">
          <div className="max-w-[760px]">
            <SectionBadge>{"\u4e00\u53e5\u8bdd\u5c31\u5b8c\u4e8b\u3002"}</SectionBadge>
            <h1 className="mt-8 font-[family:var(--font-ark-serif)] text-6xl leading-[0.95] tracking-[-0.04em] text-white sm:text-7xl lg:text-[6.7rem]">
              {"\u4e00\u53e5\u8bdd\u5c31\u5b8c\u4e8b\u3002"}
              <br />
              Island for people.
              <br />
              API for agents.
            </h1>
            <p className="mt-6 max-w-[620px] text-lg leading-8 text-white/76 sm:text-xl">
              Ark does not steal your attention. Dynamic Island and Web help
              users finish the task in hand, while the same backend gives
              enterprises and agents deterministic execution, async jobs, and
              artifact delivery.
            </p>
            <p className="mt-4 max-w-[620px] text-sm leading-7 text-white/58">
              {contract.tool_catalog.total_tools} tools are live in the current
              catalog today. The public repo is self-hosted and BYOK now; the
              managed one-key Ark service is the next layer, not a false claim
              in this repo.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="#get-started"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#12151c] transition hover:bg-[#f2efe9]"
              >
                Get started
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/developers"
                className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/10 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/16"
              >
                Developers
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href={appConfig.links.source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/10 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/16"
              >
                View GitHub
                <ArrowUpRight className="size-4" />
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-3 text-sm text-white/68">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2">
                <Layers3 className="size-4" />
                Island + Web + API
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2">
                <KeyRound className="size-4" />
                One deployment key
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2">
                <Sparkles className="size-4" />
                Artifact-first execution
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="quickstart" className="bg-[#f5f3ef] py-24">
        <div className="mx-auto grid max-w-[1140px] gap-10 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div className="max-w-[480px]">
            <h2 className="font-[family:var(--font-ark-serif)] text-[3.2rem] leading-[0.98] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4rem]">
              Three surfaces.
              <br />
              One capability layer.
            </h2>
            <p className="mt-5 text-lg leading-8 text-[#4f4a45]">
              Island is the lightweight consumer surface. Web is the full
              workspace. API is the execution surface for enterprises and
              agents. They all run on the same backend contract.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#6c655e]">
              Self-host with BYOK today. Productize the same layer into a
              managed one-key service later without rewriting the surface model.
            </p>
            <div className="mt-8 flex flex-wrap gap-5 text-sm">
              <Link
                href="/developers"
                className="inline-flex items-center gap-2 rounded-full bg-[#1a1a1a] px-5 py-3 font-medium text-white transition hover:bg-black"
              >
                Open developer contract
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/open-source"
                className="inline-flex items-center gap-2 text-[#4f4a45] transition hover:text-black"
              >
                Self-hosting docs
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          <div className="space-y-5">
            <TerminalCard
              title="Quickstart"
              subtitle="Agent-friendly onboarding command"
              command={quickstartCommand}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {contract.products.map((surface) => (
                <article
                  key={surface.id}
                  className="rounded-[24px] border border-[#dfd8d0] bg-white p-5"
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-[#8b847c]">
                    {surface.audience}
                  </div>
                  <div className="mt-3 text-lg font-semibold tracking-[-0.03em] text-[#1a1a1a]">
                    {surface.title}
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[#5a554f]">
                    {surface.summary}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-28">
        <div className="mx-auto max-w-[1140px] px-6 lg:px-8">
          <div className="overflow-hidden rounded-[32px] border border-[#dfd8d0] bg-[#111317] shadow-[0_24px_100px_rgba(11,16,28,0.12)]">
            <video
              autoPlay={!evidenceMode}
              loop={!evidenceMode}
              muted
              playsInline
              preload="metadata"
              className="aspect-[16/9] w-full object-cover"
              src="/demo/full-island-tour.mp4"
            />
          </div>

          <div className="mt-12 max-w-[760px]">
            <SectionBadge>How it works</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4.2rem]">
              Capture the work.
              <br />
              Continue the flow.
            </h2>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {steps.map((step) => (
              <article
                key={step.number}
                className="rounded-[28px] border border-[#dfd8d0] bg-[#fbfaf7] p-6"
              >
                <div className="font-[family:var(--font-ark-mono)] text-sm text-[#8b847c]">
                  {step.number}
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em] text-[#1a1a1a]">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[#5a554f]">
                  {step.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="bg-[#f5f3ef] py-28">
        <div className="mx-auto max-w-[1140px] px-6 lg:px-8">
          <div className="max-w-[700px]">
            <SectionBadge>Features</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4.2rem]">
              Everything you need to make the island useful.
            </h2>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <article
                  key={feature.title}
                  className="rounded-[28px] border border-[#dfd8d0] bg-white p-6"
                >
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-[#f4efe8] text-[#1a1a1a]">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em] text-[#1a1a1a]">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-[#5a554f]">
                    {feature.detail}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-28">
        <div className="mx-auto grid max-w-[1140px] gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <SectionBadge>Bring your own stack</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4.2rem]">
              Bring your own models,
              <br />
              speech, and storage.
            </h2>
            <p className="mt-5 max-w-[520px] text-lg leading-8 text-[#4f4a45]">
              Ark is self-hosted and BYOK. Keep the island product surface, but
              plug in the providers and local infra that already fit your stack.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {providers.map((provider) => (
                <div
                  key={provider}
                  className="rounded-full border border-[#dfd8d0] bg-[#f5f3ef] px-4 py-2 text-sm text-[#3f3a35]"
                >
                  {provider}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[28px] border border-[#dfd8d0] bg-[#13161d] p-6 text-white">
              <div className="text-sm font-medium text-white/64">
                Works across the whole surface
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {stackNodes.map((node) => (
                  <div
                    key={node}
                    className="rounded-[20px] border border-white/10 bg-white/6 px-4 py-4 text-sm text-white/86"
                  >
                    {node}
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-[#dfd8d0] bg-[#111317]">
              <video
                autoPlay={!evidenceMode}
                loop={!evidenceMode}
                muted
                playsInline
                preload="metadata"
                className="aspect-[4/5] w-full object-cover"
                src="/demo/studio-watermark-flow.mp4"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f5f3ef] py-28">
        <div className="mx-auto max-w-[1140px] px-6 lg:px-8">
          <div className="max-w-[760px]">
            <SectionBadge>Problems solved</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4.2rem]">
              Manage workflows,
              <br />
              not utility windows.
            </h2>
          </div>

          <div className="mt-12 space-y-4">
            {problems.map((problem) => (
              <div
                key={problem.without}
                className="grid gap-4 rounded-[28px] border border-[#dfd8d0] bg-white p-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center"
              >
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#8b847c]">
                    Without
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[#5a554f]">
                    {problem.without}
                  </p>
                </div>

                <div className="flex items-center justify-center text-[#8b847c]">
                  <ArrowRight className="size-5" />
                </div>

                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#8b847c]">
                    With Ark
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[#3f3a35]">
                    {problem.with}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-28">
        <div className="mx-auto max-w-[1140px] px-6 lg:px-8">
          <div className="max-w-[760px]">
            <SectionBadge>Under the hood</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4.2rem]">
              Why Ark is special.
            </h2>
            <p className="mt-4 text-lg leading-8 text-[#4f4a45]">
              Ark handles the orchestration details that make island workflows
              hold together under real use, not just in a polished demo.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {underTheHood.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="rounded-[28px] border border-[#dfd8d0] bg-[#fbfaf7] p-6"
                >
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-[#1a1a1a] shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em] text-[#1a1a1a]">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-[#5a554f]">
                    {item.detail}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#f5f3ef] py-28">
        <div className="mx-auto max-w-[1140px] px-6 lg:px-8">
          <div className="max-w-[760px]">
            <SectionBadge>Differentiation</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4.2rem]">
              What Ark is not.
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {whatItIsNot.map((item) => (
              <article
                key={item.title}
                className="rounded-[28px] border border-[#dfd8d0] bg-white p-6"
              >
                <h3 className="text-lg font-semibold tracking-[-0.03em] text-[#1a1a1a]">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[#5a554f]">
                  {item.detail}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-28">
        <div className="mx-auto max-w-[1140px] px-6 lg:px-8">
          <div className="max-w-[760px]">
            <SectionBadge>FAQ</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-[#1a1a1a] sm:text-[4.2rem]">
              Frequently asked questions.
            </h2>
          </div>

          <div className="mt-12 space-y-4">
            {faq.map((item) => (
              <details
                key={item.question}
                className="group rounded-[24px] border border-[#dfd8d0] bg-white px-6 py-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-semibold tracking-[-0.03em] text-[#1a1a1a]">
                  <span>{item.question}</span>
                  <span className="text-[#8b847c] transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-4 max-w-[820px] text-sm leading-7 text-[#5a554f]">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section
        id="get-started"
        className="relative overflow-hidden bg-[#131720] py-28 text-white"
      >
        <div className="absolute inset-0">
          <video
            autoPlay={!evidenceMode}
            loop={!evidenceMode}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover opacity-18"
            src="/demo/audio-notes-flow.mp4"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(19,23,32,0.55),rgba(19,23,32,0.92))]" />
        </div>

        <div className="relative mx-auto max-w-[1140px] px-6 lg:px-8">
          <div className="max-w-[760px]">
            <SectionBadge>Get started</SectionBadge>
            <h2 className="mt-5 font-[family:var(--font-ark-serif)] text-[3rem] leading-[1] tracking-[-0.04em] text-white sm:text-[4.2rem]">
              From zero to island-native workflows
              <br />
              in one command.
            </h2>
          </div>

          <div className="mt-10 max-w-[720px]">
            <TerminalCard
              title="Public onboarding"
              subtitle="No Ark account required. Bring your own providers."
              command={quickstartCommand}
              dark
            />
          </div>

          <div className="mt-8 flex flex-wrap gap-5 text-sm">
            <Link
              href="/open-source"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium text-[#12151c] transition hover:bg-[#efe9df]"
            >
              Open self-hosting docs
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href={appConfig.links.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-white/74 transition hover:text-white"
            >
              Read the repo
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative overflow-hidden bg-[#111622] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(119,217,255,0.15),transparent_38%)]" />
        <div className="relative mx-auto max-w-[1140px] px-6 py-16 lg:px-8">
          <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-4">
            {footerColumns.map((column) => (
              <div key={column.title}>
                <div className="text-sm font-semibold">{column.title}</div>
                <div className="mt-5 space-y-3">
                  {column.links.map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      target={link.href.startsWith("http") ? "_blank" : undefined}
                      rel={
                        link.href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      className="block text-sm text-white/66 transition hover:text-white"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-col gap-4 border-t border-white/12 pt-6 text-sm text-white/52 md:flex-row md:items-center md:justify-between">
            <span>2026 Ark. Open source under MIT.</span>
            <span>{"\u4e00\u53e5\u8bdd\u5c31\u5b8c\u4e8b\u3002"}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
