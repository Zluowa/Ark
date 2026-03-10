// @input: live session data
// @output: hero greeting section with workspace-aware quick action CTAs
// @position: top section of the Home dashboard page

"use client";

import Link from "next/link";
import { MessageSquare, Wrench } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useArkSession } from "@/components/account/session-provider";

function useGreeting() {
  const t = useT();
  const hour = new Date().getHours();
  if (hour < 12) return t("hero.morning");
  if (hour < 18) return t("hero.afternoon");
  return t("hero.evening");
}

export function WelcomeHero() {
  const t = useT();
  const greeting = useGreeting();
  const { session } = useArkSession();

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-emerald-500/10 via-background to-background p-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent" />
      <div className="relative">
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-emerald-500">
          {greeting}
        </p>
        <h1 className="text-2xl font-bold text-foreground">
          {session ? `${greeting}, ${session.user.displayName}` : t("hero.title")}
        </h1>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          {session
            ? `Active workspace: ${session.workspace.name}. Your browser session now carries the same execution context that files, connections, and tools use underneath.`
            : t("hero.subtitle")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/dashboard/agent"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
          >
            <MessageSquare className="size-4" strokeWidth={2} />
            {t("hero.cta.chat")}
          </Link>
          <Link
            href="/dashboard/tools"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
          >
            <Wrench className="size-4" strokeWidth={2} />
            {t("hero.cta.tools")}
          </Link>
        </div>
      </div>
    </div>
  );
}
