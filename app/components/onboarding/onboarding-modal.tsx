// @input: useOnboarding hook (localStorage 'omniagent-onboarding-complete')
// @output: full-screen onboarding flow with framer-motion step transitions
// @position: rendered in DashboardLayout, shown on first visit only

"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOnboarding } from "@/hooks/use-onboarding";
import { useT } from "@/lib/i18n";
import { WelcomeStep } from "./steps/welcome-step";
import { FeaturesStep } from "./steps/features-step";
import { ChatStep } from "./steps/chat-step";
import { DoneStep } from "./steps/done-step";

const TOTAL_STEPS = 4;

const stepVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};

export function OnboardingModal() {
  const { showOnboarding, completeOnboarding } = useOnboarding();
  const t = useT();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  const next = () => {
    setDirection(1);
    setStep((s) => s + 1);
  };

  const back = () => {
    setDirection(-1);
    setStep((s) => s - 1);
  };

  if (!showOnboarding) return null;

  const steps = [
    <WelcomeStep key="welcome" onNext={next} />,
    <FeaturesStep key="features" onNext={next} />,
    <ChatStep key="chat" onNext={next} />,
    <DoneStep key="done" onFinish={completeOnboarding} />,
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={completeOnboarding}
      onKeyDown={(e) => e.key === "Escape" && completeOnboarding()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="relative w-full max-w-lg mx-4 rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="flex h-1 bg-muted">
          <motion.div
            className="h-full bg-emerald-500 rounded-full"
            animate={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          />
        </div>

        {/* Skip button */}
        <button
          type="button"
          onClick={completeOnboarding}
          className="absolute top-4 right-4 text-muted-foreground/60 hover:text-foreground text-sm transition-colors z-10"
        >
          {t("onboarding.skip")}
        </button>

        {/* Step content */}
        <div className="p-8 min-h-[420px] flex flex-col">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="flex flex-1 flex-col"
            >
              {steps[step]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer: back button + progress dots */}
        <div className="flex items-center justify-between px-8 pb-6">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors disabled:invisible"
          >
            {t("onboarding.back")}
          </button>

          <div className="flex items-center gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <span
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i === step
                    ? "w-4 h-1.5 bg-emerald-500"
                    : "w-1.5 h-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          {/* Spacer to balance flex layout */}
          <span className="w-8" />
        </div>
      </motion.div>
    </div>
  );
}
