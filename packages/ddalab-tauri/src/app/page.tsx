"use client";

import { DashboardLayout } from "@/components/DashboardLayout";
import { StatePersistenceProvider } from "@/components/StatePersistenceProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BackendProvider } from "@/contexts/BackendContext";
import { CloseWarningHandler } from "@/components/CloseWarningHandler";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useTimeSeriesCacheMonitor } from "@/hooks/useTimeSeriesData";

// Import panels to trigger registration
import "@/panels";

// Conditionally import PerformanceMonitor only in development
const PerformanceMonitor =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_PROFILER === "true"
    ? require("@/components/PerformanceMonitor").PerformanceMonitor
    : null;

export default function Home() {
  // Onboarding tour
  const onboarding = useOnboarding();

  // Monitor and enforce time series cache memory limits
  // Prevents unbounded memory growth from EEG chunk caching
  useTimeSeriesCacheMonitor();

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
                  "Customize DDALAB to your needs. Configure behavior, sync settings, file paths, updates, and more.",
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
