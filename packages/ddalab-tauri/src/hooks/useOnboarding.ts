import { useCallback, useEffect, useState } from "react";
import { REPLAY_ONBOARDING_EVENT } from "@/lib/appNavigationEvents";

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

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setHasCompletedOnboarding(true);
  }, []);

  const skipOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setHasCompletedOnboarding(true);
  }, []);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    setHasCompletedOnboarding(false);
  }, []);

  useEffect(() => {
    const handleReplayOnboarding = () => {
      resetOnboarding();
    };

    window.addEventListener(REPLAY_ONBOARDING_EVENT, handleReplayOnboarding);
    return () => {
      window.removeEventListener(
        REPLAY_ONBOARDING_EVENT,
        handleReplayOnboarding,
      );
    };
  }, [resetOnboarding]);

  return {
    showOnboarding: !hasCompletedOnboarding,
    completeOnboarding,
    skipOnboarding,
    resetOnboarding,
    hasCompletedOnboarding,
  };
}
