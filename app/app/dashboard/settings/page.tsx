// @input: ApiKeyCard, AccountSection, DangerZone components
// @output: Settings page with section layout and visual hierarchy
// @position: /settings route in dashboard

"use client";

import { ApiKeyCard } from "@/components/dashboard/api-key-card";
import { AccountSection } from "@/components/dashboard/account-section";
import { DangerZone } from "@/components/dashboard/danger-zone";
import { WorkspaceSection } from "@/components/dashboard/workspace-section";
import { useT } from "@/lib/i18n";

export default function SettingsPage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">{t("page.settings")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("page.settings.subtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <ApiKeyCard />
        <AccountSection />
        <WorkspaceSection />
        <DangerZone />
      </div>
    </div>
  );
}
