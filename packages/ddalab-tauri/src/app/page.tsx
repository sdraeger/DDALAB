"use client";

import { useState, useEffect, useRef } from "react";
import { TauriService } from "@/services/tauriService";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatePersistenceProvider } from "@/components/StatePersistenceProvider";
import { useAppStore } from "@/store/appStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BackendProvider } from "@/contexts/BackendContext";
import { CloseWarningHandler } from "@/components/CloseWarningHandler";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useTimeSeriesCacheMonitor } from "@/hooks/useTimeSeriesData";
import { Loader2 } from "lucide-react";
import { createLogger } from "@/lib/logger";

// Import panels to trigger registration
import "@/panels";

const logger = createLogger("Startup");

// Conditionally import PerformanceMonitor only in development
const PerformanceMonitor =
  process.env.NODE_ENV === "development"
    ? require("@/components/PerformanceMonitor").PerformanceMonitor
    : null;

export default function Home() {
  // Detect Tauri immediately without explicit state
  const isTauri = TauriService.isTauri();

  const [isReady, setIsReady] = useState(false);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);

  // Use ref to prevent double initialization in React StrictMode
  // This is checked synchronously before async operations, providing immediate protection
  const initializingRef = useRef(false);

  // Onboarding tour
  const onboarding = useOnboarding();

  // Monitor and enforce time series cache memory limits
  // Prevents unbounded memory growth from EEG chunk caching
  useTimeSeriesCacheMonitor();

  // Use selectors to prevent unnecessary re-renders
  const isInitialized = useAppStore((state) => state.isInitialized);
  const setServerReady = useAppStore((state) => state.setServerReady);

  useEffect(() => {
    const pathname =
      typeof window !== "undefined" ? window.location.pathname : "/";

    // Only run on the main window, not popouts
    if (pathname !== "/") {
      return;
    }

    loadPreferences();
  }, [isInitialized]);

  const loadPreferences = async () => {
    // Only load preferences on the main window, not pop-outs
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      return;
    }

    // Don't reload preferences if already loaded in this session
    if (hasLoadedPreferences) {
      return;
    }

    // Synchronous check to prevent double initialization in React StrictMode
    if (initializingRef.current) {
      return;
    }
    initializingRef.current = true;

    if (TauriService.isTauri()) {
      try {
        // Load preferences (for any app-specific settings)
        await TauriService.getAppPreferences();
        setHasLoadedPreferences(true);

        // In Tauri mode with pure IPC, we're immediately ready
        logger.info("Tauri mode: Backend ready via IPC");
        setServerReady(true);
        setIsReady(true);
      } catch (error) {
        console.error("Failed to load preferences:", error);
        // Still mark as ready - the app can function without preferences
        setServerReady(true);
        setIsReady(true);
      }
    } else {
      // Non-Tauri mode - still mark as ready for development
      logger.warn("Not running in Tauri environment");
      setIsReady(true);
    }
  };

  // Show loading screen while initializing
  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Starting DDALAB...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <BackendProvider>
        <StatePersistenceProvider>
          <DashboardLayout />
          {PerformanceMonitor && <PerformanceMonitor />}
          <CloseWarningHandler />
          <OnboardingTour
            steps={[
              {
                title: "Welcome to DDALAB",
                description:
                  "Let's take a quick tour of the key features to help you get started with Delay Differential Analysis.",
              },
              {
                title: "File Selection",
                description:
                  "Start by selecting a data file from your local directory. DDALAB supports EDF, BrainVision, EEGLAB, and many other formats.",
                target: "[data-tour='file-manager']",
              },
              {
                title: "Analysis Configuration",
                description:
                  "Configure your DDA analysis by selecting variants, setting time ranges, and adjusting parameters. Use the presets for quick setup!",
                target: "[data-tour='analysis-config']",
              },
              {
                title: "Run Analysis",
                description:
                  "When you're ready, click the Run button to start your analysis. You'll see real-time progress and can cancel at any time.",
                target: "#dda-run-button",
              },
              {
                title: "Institutional Server Sync",
                description:
                  "Connect to an institutional DDALAB server to share results with colleagues on your local network. Click here to discover and connect to nearby servers.",
                target: "[data-tour='sync-server']",
              },
              {
                title: "Application Settings",
                description:
                  "Customize DDALAB to your needs. Adjust analysis engine preferences, configure sync settings, manage file paths, and more.",
                target: "[data-tour='settings-tab']",
              },
              {
                title: "Notifications",
                description:
                  "Keep track of important events, analysis completions, and system messages. Access your notification history anytime.",
                target: "[data-nav='notifications']",
              },
              {
                title: "You're All Set!",
                description:
                  "You now know the essential features of DDALAB. Start by loading a data file and running your first analysis. Happy analyzing!",
              },
            ]}
            isOpen={onboarding.showOnboarding}
            onComplete={onboarding.completeOnboarding}
            onSkip={onboarding.skipOnboarding}
          />
        </StatePersistenceProvider>
      </BackendProvider>
    </ErrorBoundary>
  );
}
