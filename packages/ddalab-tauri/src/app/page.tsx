"use client";

import { useState, useEffect, useRef } from "react";
import { TauriService } from "@/services/tauriService";
import { DashboardLayout } from "@/components/DashboardLayout";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { StatePersistenceProvider } from "@/components/StatePersistenceProvider";
import { useAppStore } from "@/store/appStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ApiServiceProvider } from "@/contexts/ApiServiceContext";
import { CloseWarningHandler } from "@/components/CloseWarningHandler";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { useOnboarding } from "@/hooks/useOnboarding";

// Conditionally import PerformanceMonitor only in development
const PerformanceMonitor =
  process.env.NODE_ENV === "development"
    ? require("@/components/PerformanceMonitor").PerformanceMonitor
    : null;

export default function Home() {
  // Detect Tauri immediately - don't use state to avoid initial false value
  const isTauri = TauriService.isTauri();

  const [isApiConnected, setIsApiConnected] = useState<boolean | null>(null);
  // Use environment variable for API URL if set (for E2E tests), otherwise default to embedded API
  const [apiUrl, setApiUrl] = useState(
    process.env.NEXT_PUBLIC_API_URL || "https://localhost:8765",
  );
  const [sessionToken, setSessionToken] = useState<string>("");
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);

  // Use ref to prevent double initialization in React StrictMode
  // This is checked synchronously before async operations, providing immediate protection
  const initializingRef = useRef(false);

  // Onboarding tour
  const onboarding = useOnboarding();

  // Use selectors to prevent unnecessary re-renders
  const isInitialized = useAppStore((state) => state.isInitialized);
  const setServerReady = useAppStore((state) => state.setServerReady);
  const setDataDirectoryPath = useAppStore(
    (state) => state.setDataDirectoryPath,
  );

  // Removed excessive render logging

  useEffect(() => {
    const pathname =
      typeof window !== "undefined" ? window.location.pathname : "/";

    // Only run on the main window, not popouts
    if (pathname !== "/") {
      return;
    }

    loadPreferences();
  }, [isInitialized]);

  useEffect(() => {
    // Skip API health check in Tauri - embedded API is always available
    if (isTauri) {
      setIsApiConnected(true);
      return;
    }

    if (apiUrl) {
      checkApiConnection();
    }
  }, [apiUrl, isTauri]);

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
        const preferences = await TauriService.getAppPreferences();
        setHasLoadedPreferences(true);

        // Get API config to determine protocol (http vs https)
        const apiConfig = await TauriService.getApiConfig();

        // CRITICAL: Default to HTTP if use_https is not explicitly true
        // (undefined, null, or false should all result in HTTP)
        const protocol = apiConfig?.use_https === true ? "https" : "http";
        const port = apiConfig?.port || 8765;
        const url = `${protocol}://localhost:${port}`;
        setApiUrl(url);

        // Check if API server is already running (for dev workflow)
        try {
          const alreadyRunning = await TauriService.checkApiConnection(url);

          if (alreadyRunning) {
            // Get the current API config from state (includes session token from running server)
            const currentConfig = await TauriService.getApiConfig();
            if (currentConfig?.session_token) {
              setSessionToken(currentConfig.session_token);
              setIsApiConnected(true);
              setServerReady(true);
              return;
            } else {
              // Server is running but has no session token (old server from before refactoring)
              // Restart it to initialize with new architecture
              try {
                await TauriService.stopLocalApiServer();
                await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for clean shutdown
              } catch (error) {
                // Expected if old server
              }
              // Fall through to start server below
            }
          }
        } catch (error) {
          // Server not running yet, will start it below
        }

        // Start local API server
        try {
          const config = await TauriService.startLocalApiServer();

          if (config?.session_token) {
            setSessionToken(config.session_token);
          }

          // CRITICAL: Update URL with actual port from server (may differ from requested port)
          const actualProtocol = config?.use_https === true ? "https" : "http";
          const actualPort = config?.port || 8765;
          const actualUrl = `${actualProtocol}://localhost:${actualPort}`;
          setApiUrl(actualUrl);

          // Wait for server to be ready with exponential backoff
          // Start with immediate check (0ms), then use exponential backoff
          let retries = 0;
          let connected = false;
          const maxRetries = 15;

          while (retries < maxRetries && !connected) {
            // Only delay after first attempt
            if (retries > 0) {
              await new Promise((resolve) =>
                setTimeout(
                  resolve,
                  Math.min(200 * Math.pow(1.5, retries - 1), 2000),
                ),
              );
            }

            try {
              connected = await TauriService.checkApiConnection(actualUrl);
              if (connected) {
                break;
              }
            } catch (error) {
              // Server not ready yet, continue retrying
            }

            retries++;
          }

          if (connected) {
            setIsApiConnected(true);

            // CRITICAL: Add a delay to allow React to process the sessionToken state update
            // and for DashboardLayout's useEffect to run and update the API service with the token.
            // This is necessary because React batches state updates and useEffects run asynchronously.
            // The 250ms delay is sufficient for the token to propagate even with Fast Refresh.
            await new Promise((resolve) => setTimeout(resolve, 250));

            setServerReady(true); // Signal that server is ready for requests
          } else {
            console.error(
              "Embedded API server failed to respond after",
              maxRetries,
              "retries",
            );
            setIsApiConnected(false);
            setServerReady(false);
          }
        } catch (error) {
          console.error("Failed to start embedded API:", error);
          setIsApiConnected(false);
          setServerReady(false);
        }
      } catch (error) {
        console.error("Failed to load preferences:", error);
        setIsApiConnected(false);
        setServerReady(false);
      }
    }
  };

  const checkApiConnection = async () => {
    try {
      let connected = false;

      if (isTauri) {
        connected = await TauriService.checkApiConnection(apiUrl);
      } else {
        const response = await fetch(`${apiUrl}/api/health`);
        connected = response.ok;
      }

      setIsApiConnected(connected);

      // In browser mode with external API, set server ready with placeholder token
      if (connected && !isTauri) {
        setSessionToken("browser-mode-no-auth");
        setDataDirectoryPath(".");
        setServerReady(true);
      }

      if (connected && isTauri) {
        await TauriService.setWindowTitle("DDALAB - Connected");
        await TauriService.showNotification(
          "DDALAB",
          "Successfully connected to API server",
        );
      } else if (isTauri) {
        await TauriService.setWindowTitle("DDALAB - Disconnected");
      }
    } catch (error) {
      console.error("Failed to connect to API:", error);
      setIsApiConnected(false);
      setServerReady(false);

      if (isTauri) {
        await TauriService.setWindowTitle("DDALAB - Disconnected");
      }
    }
  };

  const handleApiUrlChange = async (newUrl: string) => {
    setApiUrl(newUrl);

    if (isTauri) {
      try {
        const preferences = await TauriService.getAppPreferences();
        preferences.api_config.url = newUrl;
        await TauriService.saveAppPreferences(preferences);
      } catch (error) {
        console.error("Failed to save API URL:", error);
      }
    }
  };

  // Show loading screen while initializing (same message for both web and Tauri to avoid hydration mismatch)
  if (isApiConnected === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Starting DDALAB...</p>
        </div>
      </div>
    );
  }

  // In web mode, show welcome screen if not connected
  if (!isTauri && !isApiConnected) {
    return (
      <WelcomeScreen
        onApiUrlChange={handleApiUrlChange}
        onRetryConnection={checkApiConnection}
      />
    );
  }

  return (
    <ErrorBoundary>
      <ApiServiceProvider apiUrl={apiUrl} sessionToken={sessionToken}>
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
      </ApiServiceProvider>
    </ErrorBoundary>
  );
}
