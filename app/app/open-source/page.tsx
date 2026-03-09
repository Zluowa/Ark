import Link from "next/link";
import { ArrowUpRight, FileCode2, Github, Server } from "lucide-react";
import { appConfig } from "@/lib/config/app-config";

const steps = [
  {
    title: "1. Configure providers",
    detail:
      "Copy `app/.env.example` to `app/.env.local` and add only the providers you plan to use.",
  },
  {
    title: "2. Start infra",
    detail:
      "Run `docker compose -f infra/docker-compose.yml up -d` when you want durable state and artifacts.",
  },
  {
    title: "3. Run the app",
    detail: "Start the public site and dashboard with `pnpm --dir app dev`.",
  },
  {
    title: "4. Run the island",
    detail:
      "Start the native shell with `cargo run --manifest-path desktop/Cargo.toml -p omniagent-island` on Windows.",
  },
];

const envGroups = [
  {
    title: "Core models",
    lines: [
      "`OPENAI_API_KEY`",
      "`OPENAI_BASE_URL`",
      "`OMNIAGENT_RELAY_BASE_URL`",
      "`OMNIAGENT_RELAY_API_KEY`",
    ],
  },
  {
    title: "Capture AI",
    lines: [
      "`GEMINI_API_KEY` or `GOOGLE_API_KEY`",
      "`VOLCENGINE_APPID`",
      "`VOLCENGINE_ACCESS_TOKEN`",
    ],
  },
  {
    title: "Local infra",
    lines: [
      "`DATABASE_URL`",
      "`REDIS_URL`",
      "`S3_ENDPOINT` and `S3_*`",
      "`OMNIAGENT_EXECUTOR_BASE_URL`",
    ],
  },
];

export default function OpenSourcePage() {
  return (
    <main className="min-h-screen bg-[#f4f3ee] text-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-14 lg:px-10">
        <header className="grid gap-8 rounded-[2.5rem] bg-slate-950 px-8 py-10 text-white shadow-[0_30px_120px_rgba(15,23,42,0.28)] lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">
              Open source guide
            </p>
            <h1 className="mt-4 text-5xl font-semibold tracking-[-0.05em]">
              Self-host the full island stack.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
              This guide mirrors the public-safe setup for Ark: website,
              dashboard, native island, optional infra, and BYOK providers.
              No private project dependency is required.
            </p>
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
            <div className="space-y-4 text-sm text-slate-200">
              <div className="flex items-center gap-3">
                <Github className="size-4 text-cyan-300" />
                <span>GitHub-ready repo hygiene included</span>
              </div>
              <div className="flex items-center gap-3">
                <Server className="size-4 text-cyan-300" />
                <span>Compose-based local infra</span>
              </div>
              <div className="flex items-center gap-3">
                <FileCode2 className="size-4 text-cyan-300" />
                <span>Placeholder-only env examples</span>
              </div>
              <Link
                href={appConfig.links.source}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 font-medium text-slate-950"
              >
                View source
                <ArrowUpRight className="size-4" />
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-2">
          {steps.map((step) => (
            <article
              key={step.title}
              className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.06)]"
            >
              <h2 className="text-2xl font-semibold">{step.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {step.detail}
              </p>
            </article>
          ))}
        </section>

        <section className="rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
            Environment groups
          </p>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {envGroups.map((group) => (
              <article
                key={group.title}
                className="rounded-[1.8rem] bg-slate-950 px-5 py-6 text-slate-50"
              >
                <h3 className="text-lg font-semibold">{group.title}</h3>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  {group.lines.map((line) => (
                    <div key={line} className="rounded-xl bg-white/5 px-3 py-2">
                      {line}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          id="github"
          className="grid gap-6 rounded-[2.5rem] bg-[#dde7ec] p-8 lg:grid-cols-[1fr_1fr]"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
              Publish checklist
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
              Before you push this to GitHub
            </h2>
          </div>
          <div className="space-y-3 text-sm text-slate-700">
            <div className="rounded-2xl bg-white px-4 py-3">
              Verify `app/.env.example` contains placeholders only.
            </div>
            <div className="rounded-2xl bg-white px-4 py-3">
              If you fork Ark, set `NEXT_PUBLIC_OMNIAGENT_GITHUB_URL` to your
              actual repository.
            </div>
            <div className="rounded-2xl bg-white px-4 py-3">
              Run `pnpm --dir app typecheck`, `pnpm --dir app build`, and Rust tests.
            </div>
            <div className="rounded-2xl bg-white px-4 py-3">
              Review screenshots and logs for secrets, cookies, or private URLs.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
