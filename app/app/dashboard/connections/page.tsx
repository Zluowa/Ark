// @input: none (static route)
// @output: Connections page with enhanced header + grouped grid
// @position: /dashboard/connections route within DashboardLayout

"use client";

import { ConnectionGrid } from "@/components/connections/connection-grid";
import { Plug } from "lucide-react";
import { useT } from "@/lib/i18n";

export default function ConnectionsPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
          <Plug className="size-5 text-emerald-500" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground">{t("page.connections")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("page.connections.subtitle")}
          </p>
        </div>
      </div>
      <ConnectionGrid />
    </div>
  );
}
