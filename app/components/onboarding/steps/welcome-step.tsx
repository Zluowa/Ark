// @input: onNext callback
// @output: welcome step with brand + tagline
// @position: step 1 of OnboardingModal

"use client";

import { Zap, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/25">
        <Zap className="size-8 text-zinc-950" strokeWidth={2.5} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-foreground">{t("onboarding.welcome.title")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground max-w-sm">
          {t("onboarding.welcome.desc")}
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
        <Button onClick={onNext} className="w-full gap-2">
          {t("onboarding.welcome.cta")}
          <ArrowRight className="size-4" />
        </Button>
        <p className="text-[11px] text-muted-foreground/60">{t("onboarding.welcome.time")}</p>
      </div>
    </div>
  );
}
