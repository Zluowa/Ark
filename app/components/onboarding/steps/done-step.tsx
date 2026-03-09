// @input: onFinish callback
// @output: completion step with start CTA
// @position: step 4 of OnboardingModal

"use client";

import { CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function DoneStep({ onFinish }: { onFinish: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="relative flex size-16 items-center justify-center rounded-2xl bg-emerald-500/10">
        <CheckCircle2 className="size-8 text-emerald-500" strokeWidth={1.5} />
        <Sparkles className="absolute -top-1 -right-1 size-4 text-amber-400" />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-foreground">{t("onboarding.done.title")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground max-w-xs">
          {t("onboarding.done.desc")}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
        <Button onClick={onFinish} className="w-full gap-2">
          {t("onboarding.done.cta")}
        </Button>
        <p className="text-[11px] text-muted-foreground/60">{t("onboarding.done.hint")}</p>
      </div>
    </div>
  );
}
