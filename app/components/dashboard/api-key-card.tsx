// @input: none (self-contained with mock state)
// @output: API Key section with copy/reset, confirm dialog on reset
// @position: first section on /settings page

"use client";

import { useState } from "react";
import { Copy, RotateCcw, Eye, EyeOff, KeyRound } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/lib/i18n";

const MOCK_KEY = "oa_sk_RYhyVprZ4nX8mK2jQwL9pTdBsEfGh1Ie";

export function ApiKeyCard() {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const maskedKey = `${MOCK_KEY.slice(0, 12)} ... ${MOCK_KEY.slice(-6)}`;

  function handleCopy() {
    navigator.clipboard.writeText(MOCK_KEY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleReset() {
    // placeholder: regenerate key via API
    console.log("API key regenerated");
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">{t("apikey.title")}</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {t("apikey.desc")}
      </p>

      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-lg border border-border bg-background px-4 py-2.5">
          <code className="flex-1 select-all font-mono text-sm text-foreground">
            {visible ? MOCK_KEY : maskedKey}
          </code>
          <button
            onClick={() => setVisible((v) => !v)}
            className="ml-2 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={visible ? t("apikey.hide") : t("apikey.show")}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-accent px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/80"
        >
          <Copy className="size-3.5" />
          {copied ? t("apikey.copied") : t("apikey.copy")}
        </button>

        <button
          onClick={() => setConfirmOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-accent px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/80"
        >
          <RotateCcw className="size-3.5" />
          {t("apikey.reset")}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("apikey.confirm.title")}
        description={t("apikey.confirm.desc")}
        confirmLabel={t("apikey.confirm.action")}
        onConfirm={handleReset}
        destructive
      />
    </section>
  );
}
