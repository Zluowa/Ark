// @input: session data from SessionProvider
// @output: account info section with real logged-in identity
// @position: settings page account block

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useArkSession } from "@/components/account/session-provider";
import { useT } from "@/lib/i18n";

const formatDate = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));

export function AccountSection() {
  const router = useRouter();
  const t = useT();
  const { refresh, session } = useArkSession();
  const [loggingOut, setLoggingOut] = useState(false);
  const [message, setMessage] = useState("");

  const rows = [
    {
      label: t("account.email"),
      value: session?.user.email ?? "Not signed in",
    },
    {
      label: "Display name",
      value: session?.user.displayName ?? "Ark User",
    },
    {
      label: "Workspace",
      value: session?.workspace.name ?? "No workspace",
    },
    {
      label: t("account.since"),
      value: session ? formatDate(session.user.createdAt) : "—",
    },
  ];

  const handleLogout = async () => {
    setLoggingOut(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error("Failed to log out.");
      }
      await refresh();
      router.replace("/auth");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to log out.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserCircle className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{t("account.title")}</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Logging out
            </>
          ) : (
            <>
              <LogOut className="size-3.5" />
              Log out
            </>
          )}
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Real browser account identity, not placeholder profile copy.
      </p>

      <div className="space-y-3">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="truncate text-right text-sm text-foreground">{value}</span>
          </div>
        ))}
      </div>

      {message ? <p className="mt-4 text-xs text-amber-600">{message}</p> : null}
    </section>
  );
}
