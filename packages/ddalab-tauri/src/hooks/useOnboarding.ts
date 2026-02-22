import { useState } from "react";

const ONBOARDING_STORAGE_KEY = "ddalab_onboarding_completed";

export interface OnboardingState {
  showOnboarding: boolean;
  completeOnboarding: () => void;
  skipOnboarding: () => void;
  resetOnboarding: () => void;
  hasCompletedOnboarding: boolean;
}

export function useOnboarding(): OnboardingState {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    const completed = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return completed === "true";
  });

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setHasCompletedOnboarding(true);
  };

  const skipOnboarding = () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setHasCompletedOnboarding(true);
  };

  const resetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    setHasCompletedOnboarding(false);
  };

  return {
    showOnboarding: !hasCompletedOnboarding,
    completeOnboarding,
    skipOnboarding,
    resetOnboarding,
    hasCompletedOnboarding,
  };
}
