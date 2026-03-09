// @input: none
// @output: danger zone section with confirm dialogs for destructive actions
// @position: last section on /settings page

"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT, type MessageKey } from "@/lib/i18n";

const DANGER_DEFS: { id: string; labelKey: MessageKey; descKey: MessageKey; confirmTitleKey: MessageKey; confirmDescKey: MessageKey; confirmLabelKey: MessageKey }[] = [
  { id: "reset-settings", labelKey: "danger.reset.label", descKey: "danger.reset.desc", confirmTitleKey: "danger.reset.confirm.title", confirmDescKey: "danger.reset.confirm.desc", confirmLabelKey: "danger.reset.confirm.action" },
  { id: "clear-usage", labelKey: "danger.clearUsage.label", descKey: "danger.clearUsage.desc", confirmTitleKey: "danger.clearUsage.confirm.title", confirmDescKey: "danger.clearUsage.confirm.desc", confirmLabelKey: "danger.clearUsage.confirm.action" },
  { id: "delete-account", labelKey: "danger.delete.label", descKey: "danger.delete.desc", confirmTitleKey: "danger.delete.confirm.title", confirmDescKey: "danger.delete.confirm.desc", confirmLabelKey: "danger.delete.confirm.action" },
];

export function DangerZone() {
  const t = useT();
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const actions = DANGER_DEFS.map((d) => ({
    id: d.id,
    label: t(d.labelKey),
    description: t(d.descKey),
    confirmTitle: t(d.confirmTitleKey),
    confirmDescription: t(d.confirmDescKey),
    confirmLabel: t(d.confirmLabelKey),
  }));

  const current = actions.find((a) => a.id === activeAction) ?? null;

  function handleConfirm() {
    console.log(`Executed: ${activeAction}`);
  }

  return (
    <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
      <div className="mb-1 flex items-center gap-2">
        <TriangleAlert className="size-4 text-red-400" />
        <h2 className="text-sm font-semibold text-red-400">{t("danger.title")}</h2>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        {t("danger.desc")}
      </p>

      <div className="space-y-3">
        {actions.map(({ id, label, description }) => (
          <div
            key={id}
            className="flex items-center justify-between rounded-lg border border-red-500/20 bg-background/50 px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <button
              onClick={() => setActiveAction(id)}
              className="ml-4 shrink-0 rounded-md border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              {label.split(" ").slice(0, 2).join(" ")}
            </button>
          </div>
        ))}
      </div>

      {current && (
        <ConfirmDialog
          open={activeAction !== null}
          onOpenChange={(open) => !open && setActiveAction(null)}
          title={current.confirmTitle}
          description={current.confirmDescription}
          confirmLabel={current.confirmLabel}
          onConfirm={handleConfirm}
          destructive
        />
      )}
    </section>
  );
}
