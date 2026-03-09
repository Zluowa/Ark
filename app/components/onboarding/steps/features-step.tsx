// @input: onNext callback
// @output: 4 core feature cards
// @position: step 2 of OnboardingModal

"use client";

import { FileText, Download, MessageCircle, Wrench, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/lib/i18n";

const FEATURE_DEFS: { icon: typeof FileText; color: string; titleKey: MessageKey; descKey: MessageKey }[] = [
  { icon: FileText, color: "bg-blue-500/10 text-blue-400", titleKey: "onboarding.features.files", descKey: "onboarding.features.files.desc" },
  { icon: Download, color: "bg-rose-500/10 text-rose-400", titleKey: "onboarding.features.media", descKey: "onboarding.features.media.desc" },
  { icon: MessageCircle, color: "bg-emerald-500/10 text-emerald-400", titleKey: "onboarding.features.chat", descKey: "onboarding.features.chat.desc" },
  { icon: Wrench, color: "bg-purple-500/10 text-purple-400", titleKey: "onboarding.features.more", descKey: "onboarding.features.more.desc" },
];

export function FeaturesStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t("onboarding.features.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.features.desc")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {FEATURE_DEFS.map((f) => (
          <div key={f.titleKey} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <div className={`flex size-9 items-center justify-center rounded-lg ${f.color}`}>
              <f.icon className="size-4" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{t(f.titleKey)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t(f.descKey)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto">
        <Button onClick={onNext} className="w-full gap-2">
          {t("onboarding.features.next")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
