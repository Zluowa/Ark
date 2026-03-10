// @input: none
// @output: danger zone section with confirm dialogs for destructive actions
// @position: last section on /settings page

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useArkSession } from "@/components/account/session-provider";
import { useT, type MessageKey } from "@/lib/i18n";

const DELETE_ACTION: {
  labelKey: MessageKey;
  descKey: MessageKey;
  confirmTitleKey: MessageKey;
  confirmDescKey: MessageKey;
  confirmLabelKey: MessageKey;
} = {
  labelKey: "danger.delete.label",
  descKey: "danger.delete.desc",
  confirmTitleKey: "danger.delete.confirm.title",
  confirmDescKey: "danger.delete.confirm.desc",
  confirmLabelKey: "danger.delete.confirm.action",
};

export function DangerZone() {
  const router = useRouter();
  const t = useT();
  const { refresh } = useArkSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  const action = {
    label: t(DELETE_ACTION.labelKey),
    description: t(DELETE_ACTION.descKey),
    confirmTitle: t(DELETE_ACTION.confirmTitleKey),
    confirmDescription: t(DELETE_ACTION.confirmDescKey),
    confirmLabel: t(DELETE_ACTION.confirmLabelKey),
  };

  const handleDelete = async () => {
    setDeleting(true);
    setMessage("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message || "Failed to delete account.");
      }
      await refresh();
      router.replace("/auth");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to delete account.",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
      <div className="mb-1 flex items-center gap-2">
        <TriangleAlert className="size-4 text-red-400" />
        <h2 className="text-sm font-semibold text-red-400">{t("danger.title")}</h2>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        {t("danger.desc")}
      </p>

      <div className="rounded-lg border border-red-500/20 bg-background/50 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">{action.label}</p>
            <p className="text-xs text-muted-foreground">{action.description}</p>
          </div>
          <button
            onClick={() => setDialogOpen(true)}
            disabled={deleting}
            className="ml-4 inline-flex shrink-0 items-center gap-2 rounded-md border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {action.label}
          </button>
        </div>
        {message ? <p className="mt-3 text-xs text-red-300">{message}</p> : null}
      </div>

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={action.confirmTitle}
        description={action.confirmDescription}
        confirmLabel={action.confirmLabel}
        onConfirm={() => void handleDelete()}
        destructive
      />
    </section>
  );
}
