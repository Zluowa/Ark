// @input: localStorage key 'omniagent-onboarding-complete'
// @output: { showOnboarding, completeOnboarding, resetOnboarding }
// @position: state manager for first-visit onboarding gate

"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "omniagent-onboarding-complete";

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setShowOnboarding(true);
    }
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setShowOnboarding(false);
  };

  const resetOnboarding = () => {
    localStorage.removeItem(STORAGE_KEY);
    setShowOnboarding(true);
  };

  return { showOnboarding, completeOnboarding, resetOnboarding };
}
