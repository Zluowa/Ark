// @input: onNext callback
// @output: "Chat with AI" explainer step with agent feature highlights
// @position: step 3 of OnboardingModal

"use client";

import { MessageSquare, Paperclip, Brain, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/lib/i18n";

const HIGHLIGHT_DEFS: { icon: typeof Brain; color: string; bg: string; labelKey: MessageKey; descKey: MessageKey }[] = [
  { icon: Brain, color: "text-violet-400", bg: "bg-violet-500/10", labelKey: "onboarding.chat.models", descKey: "onboarding.chat.models.desc" },
  { icon: Paperclip, color: "text-sky-400", bg: "bg-sky-500/10", labelKey: "onboarding.chat.attach", descKey: "onboarding.chat.attach.desc" },
  { icon: Sparkles, color: "text-amber-400", bg: "bg-amber-500/10", labelKey: "onboarding.chat.tools", descKey: "onboarding.chat.tools.desc" },
];

export function ChatStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10">
          <MessageSquare className="size-5 text-emerald-400" strokeWidth={1.8} />
        </div>
        <h2 className="mt-3 text-xl font-bold text-foreground">{t("onboarding.chat.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.chat.desc")}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {HIGHLIGHT_DEFS.map((h) => (
          <div
            key={h.labelKey}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5"
          >
            <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${h.bg}`}>
              <h.icon className={`size-4 ${h.color}`} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t(h.labelKey)}</p>
              <p className="text-[11px] text-muted-foreground">{t(h.descKey)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto">
        <Button onClick={onNext} className="w-full gap-2">
          {t("onboarding.chat.next")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
