// @input: static account data (email, plan, created date)
// @output: account info section with section header and icon
// @position: second section on /settings page

"use client";

import { UserCircle } from "lucide-react";
import { useT } from "@/lib/i18n";

export function AccountSection() {
  const t = useT();
  const rows = [
    { label: t("account.email"), value: "user@omniagent.dev", action: null },
    { label: t("account.plan"), value: "Hobby (Free)", action: { text: t("account.upgrade"), href: "#" } },
    { label: t("account.since"), value: "Jan 15, 2026", action: null },
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <UserCircle className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t("account.title")}</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {t("account.desc")}
      </p>

      <div className="space-y-3">
        {rows.map(({ label, value, action }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="flex items-center gap-2 text-sm text-foreground">
              {value}
              {action && (
                <a
                  href={action.href}
                  className="text-emerald-500 transition-colors hover:text-emerald-400"
                >
                  {action.text}
                </a>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
