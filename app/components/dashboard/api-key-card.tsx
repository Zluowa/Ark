// @input: session context
// @output: developer-access card for the current workspace, without fake keys
// @position: settings page developer-access block

"use client";

import Link from "next/link";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useArkSession } from "@/components/account/session-provider";

export function ApiKeyCard() {
  const t = useT();
  const { session } = useArkSession();

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t("apikey.title")}</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Browser sessions now power consumer usage. Ark-issued API keys belong to the
        operator and developer lane, not to this consumer settings page.
      </p>

      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Current tenant execution context
            </p>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {session?.workspace.tenantId ?? "No active workspace"}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Need agent or enterprise access? Managed Ark keys are issued from the
              operator plane and documented in the developer surface.
            </p>
          </div>
          <Link
            href="/developers"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60"
          >
            Developers
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
