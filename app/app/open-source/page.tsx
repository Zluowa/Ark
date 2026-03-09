import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileCode2, Github, Server } from "lucide-react";
import { appConfig } from "@/lib/config/app-config";

const quickstart = [
  "git clone https://github.com/Zluowa/Ark.git",
  "cd Ark",
  "pnpm --dir app install",
  "cp app/.env.example app/.env.local",
  "docker compose -f infra/docker-compose.yml up -d",
  "pnpm --dir app dev",
  "cargo run --manifest-path desktop/Cargo.toml -p omniagent-island",
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

const faq = [
  {
    question: "What is the smallest setup?",
    answer:
      "Run the web app alone with your own model keys, then add the native island or Compose services when you want the full product surface.",
  },
  {
    question: "Do I need your hosted backend?",
    answer:
      "No. Ark is public-safe and BYOK. The repo is meant to make sense without our private infra.",
  },
  {
    question: "Can I fork and rebrand it?",
    answer:
      "Yes. Update the source links, public copy, and env values in your own fork, then keep the same self-hosted contract.",
  },
  {
    question: "What should I verify before publishing my fork?",
    answer:
      "Check placeholder-only env examples, source links, public docs, and homepage copy, then run typecheck, build, tests, and UI evidence.",
  },
];

export default function OpenSourcePage() {
  return (
    <main className="min-h-screen bg-[#f6f2e8] text-neutral-950">
      <div className="h-3 bg-[linear-gradient(90deg,#6ed7ff_0%,#c6f36d_28%,#ffb867_58%,#ff84d4_100%)]" />

      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-12 lg:px-10">
        <header className="max-w-4xl">
          <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
            Open source guide
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.06em] sm:text-6xl">
            Self-host the full island stack.
          </h1>
          <p className="mt-6 text-lg leading-8 text-neutral-600">
            This is the public-safe quickstart for Ark: website, dashboard,
            native island, optional local infra, and BYOK providers. No private
            project dependency is required.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={appConfig.links.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
            >
              <Github className="size-4" />
              View source
              <ArrowUpRight className="size-4" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:border-black"
            >
              Back to homepage
            </Link>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div className="overflow-hidden rounded-[2rem] border border-black/8 bg-[#0c0d10] text-white">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.22em] text-white/44">
              <span>Quickstart</span>
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

          <div className="grid gap-4">
            <article className="rounded-[1.8rem] border border-black/8 bg-white p-6">
              <Github className="size-5" />
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
                GitHub-ready repo hygiene
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                README, license, CI, issue templates, security policy, docs, and
                public landing page all ship as part of the default Ark repo.
              </p>
            </article>
            <article className="rounded-[1.8rem] border border-black/8 bg-white p-6">
              <Server className="size-5" />
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
                Compose-based local infra
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                PostgreSQL, Redis, MinIO, and the executor service are optional,
                documented, and public-safe. They are not hidden runtime assumptions.
              </p>
            </article>
            <article className="rounded-[1.8rem] border border-black/8 bg-white p-6">
              <FileCode2 className="size-5" />
              <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
                Placeholder-only env examples
              </h2>
              <p className="mt-3 text-sm leading-7 text-neutral-600">
                The public contract is BYOK. Docs and examples explain which keys
                you can bring without exposing private credentials.
              </p>
            </article>
          </div>
        </section>

        <section className="rounded-[2rem] border border-black/8 bg-white p-8">
          <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-500">
            Environment groups
          </p>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {envGroups.map((group) => (
              <article
                key={group.title}
                className="rounded-[1.7rem] border border-black/8 bg-[#f7f3ea] p-5"
              >
                <h2 className="text-lg font-semibold">{group.title}</h2>
                <div className="mt-4 space-y-3 text-sm text-neutral-700">
                  {group.lines.map((line) => (
                    <div key={line} className="rounded-xl bg-white px-3 py-2">
                      {line}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {faq.map((item) => (
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
        </section>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[2rem] bg-[#111214] px-6 py-6 text-white">
          <div>
            <div className="text-2xl font-semibold tracking-[-0.04em]">
              Ready to fork your own island stack?
            </div>
            <div className="mt-2 text-sm text-white/62">
              Start from the public docs, then move into the dashboard and native runtime.
            </div>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
          >
            Open dashboard
            <ArrowRight className="size-4" />
          </Link>
        </section>
      </div>
    </main>
  );
}
