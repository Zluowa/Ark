import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Github } from "lucide-react";
import { appConfig } from "@/lib/config/app-config";
import { footerColumns, publicNav } from "@/lib/config/platform-site";

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[#d7cfbf] bg-[#f5efe1] px-3 py-1 font-medium text-[#5b564d] text-[11px] uppercase tracking-[0.24em]">
      {children}
    </span>
  );
}

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-black/6 border-b bg-[#f6f1e7]/88 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4 lg:px-10">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-[#101114] font-semibold text-sm text-white">
            A
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[#101114] text-sm tracking-[-0.03em]">
              Ark
            </div>
            <div className="text-[#6a6357] text-xs">
              Web, island, API, and shared execution
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-black/8 bg-white/80 p-1 lg:flex">
          {publicNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-4 py-2 text-[#332f28] text-sm transition hover:bg-[#f2ecdf]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={appConfig.links.source}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2 font-medium text-[#171717] text-sm transition hover:border-black lg:inline-flex"
          >
            <Github className="size-4" />
            Source
          </Link>
          <Link
            href="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-[#111318] px-4 py-2 font-medium text-sm text-white transition hover:bg-[#22252c]"
          >
            Sign in
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-black/8 border-t bg-[#ece4d3]">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[1.2fr_2fr] lg:px-10">
        <div>
          <div className="font-semibold text-2xl text-[#111318] tracking-[-0.05em]">
            One backend. Multiple surfaces. No duplicate tool layers.
          </div>
          <p className="mt-3 max-w-md text-[#625b4f] text-sm leading-7">
            Ark keeps the account, Web, desktop, API, SDK, MCP, and future
            skills aligned around the same execution contract.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
          {footerColumns.map((column) => (
            <div key={column.title}>
              <div className="text-[#746d61] text-xs uppercase tracking-[0.22em]">
                {column.title}
              </div>
              <div className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <Link
                    key={`${column.title}-${link.href}`}
                    href={link.href}
                    target={link.external ? "_blank" : undefined}
                    rel={link.external ? "noopener noreferrer" : undefined}
                    className="flex items-center gap-2 text-[#181818] text-sm transition hover:text-[#4d6b87]"
                  >
                    {link.label}
                    {link.external ? (
                      <ArrowUpRight className="size-3.5" />
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}

export function MarketingShell({
  children,
  hero,
}: {
  children: ReactNode;
  hero?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f6f1e7] text-[#141414]">
      <div className="h-2 bg-[linear-gradient(90deg,#a8d5ff_0%,#d9f79e_26%,#ffd28f_58%,#ffc7e5_100%)]" />
      <PublicHeader />
      {hero ? (
        <section className="relative overflow-hidden border-black/6 border-b">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(131,197,255,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(255,201,230,0.16),transparent_30%),linear-gradient(180deg,#fbf7ef_0%,#f6f1e7_100%)]" />
          <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-24">
            {hero}
          </div>
        </section>
      ) : null}
      <div className="mx-auto flex max-w-7xl flex-col gap-16 px-6 py-14 lg:px-10">
        {children}
      </div>
      <PublicFooter />
    </main>
  );
}

export function CodePanel({
  title,
  subtitle,
  code,
  note,
}: {
  title: string;
  subtitle: string;
  code: string;
  note?: string;
}) {
  return (
    <article className="overflow-hidden rounded-[28px] border border-white/10 bg-[#101216] text-white shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
      <div className="flex items-center justify-between border-white/8 border-b px-5 py-4">
        <div>
          <div className="text-[11px] text-white/40 uppercase tracking-[0.22em]">
            {title}
          </div>
          <div className="mt-1 text-sm text-white/68">{subtitle}</div>
        </div>
      </div>
      <pre className="overflow-x-auto px-5 py-5 font-[family:var(--font-ark-mono)] text-[13px] text-white/90 leading-7">
        {code}
      </pre>
      {note ? (
        <div className="border-white/8 border-t px-5 py-4 text-sm text-white/62 leading-7">
          {note}
        </div>
      ) : null}
    </article>
  );
}
