"use client";

import { useState, useEffect, useRef } from "react";
import { TauriService } from "@/services/tauriService";
import { DashboardLayout } from "@/components/DashboardLayout";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { StatePersistenceProvider } from "@/components/StatePersistenceProvider";
import { useAppStore } from "@/store/appStore";
import { useNotificationStore } from "@/store/notificationStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ApiServiceProvider } from "@/contexts/ApiServiceContext";
import { CloseWarningHandler } from "@/components/CloseWarningHandler";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { useOnboarding } from "@/hooks/useOnboarding";
import { Loader2 } from "lucide-react";
import { importKey } from "@/utils/crypto";
import { createLogger } from "@/lib/logger";

const logger = createLogger("Startup");

// Conditionally import PerformanceMonitor only in development
const PerformanceMonitor =
  process.env.NODE_ENV === "development"
    ? require("@/components/PerformanceMonitor").PerformanceMonitor
    : null;

/**
 * Create a listener for the API service auth ready event.
 * IMPORTANT: Call this BEFORE triggering the state update that will cause the event,
 * then await the returned promise AFTER the state update.
 * Returns a promise that resolves when the event fires or times out.
 */
function createAuthReadyListener(timeoutMs: number = 5000): Promise<boolean> {
  logger.debug("Setting up auth ready listener", { timeoutMs });
  return new Promise((resolve) => {
    let resolved = false;

    const handler = () => {
      if (resolved) return;
      resolved = true;
      logger.info("Auth ready event received");
      window.removeEventListener("api-service-auth-ready", handler);
      resolve(true);
    };

    window.addEventListener("api-service-auth-ready", handler);

    // Timeout fallback - resolve with false if event doesn't fire
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      logger.warn("Auth ready event timed out", { timeoutMs });
      window.removeEventListener("api-service-auth-ready", handler);
      resolve(false);
    }, timeoutMs);
  });
}

export default function Home() {
  // Detect Tauri immediately without explicit state
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
  const setEncryptionKey = useAppStore((state) => state.setEncryptionKey);
  const setEncryptedMode = useAppStore((state) => state.setEncryptedMode);

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
          logger.debug("Checking if API server is already running", { url });
          const alreadyRunning = await TauriService.checkApiConnection(url);

          if (alreadyRunning) {
            logger.info("Found existing API server running");
            // Get the current API config from state (includes session token from running server)
            const currentConfig = await TauriService.getApiConfig();
            if (currentConfig?.session_token) {
              logger.debug("Got session token from existing server", {
                tokenPrefix: currentConfig.session_token.substring(0, 8),
              });
              // Set up listener BEFORE triggering state update
              const authReadyPromise = createAuthReadyListener(5000);

              setSessionToken(currentConfig.session_token);
              setIsApiConnected(true);

              // Wait for ApiServiceProvider to receive the token and dispatch the ready event.
              const authReady = await authReadyPromise;
              if (!authReady) {
                logger.warn(
                  "Auth ready event not received within timeout, proceeding anyway",
                );
              }

              logger.info("Setting server ready (existing server)");
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
          logger.info("Starting local API server");
          const config = await TauriService.startLocalApiServer();
          logger.debug("Server started", {
            port: config?.port,
            useHttps: config?.use_https,
            hasToken: !!config?.session_token,
          });

          // Set up auth listener BEFORE triggering state update (if token exists)
          let authReadyPromise: Promise<boolean> | null = null;
          if (config?.session_token) {
            authReadyPromise = createAuthReadyListener(5000);
            setSessionToken(config.session_token);
            logger.debug("Session token set", {
              tokenPrefix: config.session_token.substring(0, 8),
            });
          }

          // Handle encryption key if present (HTTP fallback mode)
          if (config?.encryption_key && config.using_encryption) {
            try {
              // Decode base64 key from server
              const keyBytes = Uint8Array.from(
                atob(config.encryption_key),
                (c) => c.charCodeAt(0),
              );
              const cryptoKey = await importKey(keyBytes);
              setEncryptionKey(cryptoKey);
              setEncryptedMode(true);
              console.log("Using HTTP with application-layer encryption");

              // Notify user about fallback mode
              const { addNotification } = useNotificationStore.getState();
              addNotification({
                type: "warning",
                category: "system",
                title: "Running in encrypted HTTP mode",
                message:
                  "Certificate generation unavailable. Install mkcert for native HTTPS: choco install mkcert (Windows)",
                persistent: false,
              });
            } catch (error) {
              console.error("Failed to import encryption key:", error);
            }
          }

          // CRITICAL: Update URL with actual port from server (may differ from requested port)
          // Update URL based on encryption mode
          const actualProtocol = config?.using_encryption
            ? "http"
            : config?.use_https === true
              ? "https"
              : "http";
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
            logger.info("API server connection verified", { retries });
            setIsApiConnected(true);

            // Wait for ApiServiceProvider to receive the token and dispatch the ready event.
            if (authReadyPromise) {
              const authReady = await authReadyPromise;
              if (!authReady) {
                logger.warn(
                  "Auth ready event not received within timeout, proceeding anyway",
                );
              }
            }

            logger.info("Setting server ready (new server)");
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
        // Set up listener BEFORE triggering state update
        const authReadyPromise = createAuthReadyListener(5000);

        setSessionToken("browser-mode-no-auth");
        setDataDirectoryPath(".");

        // Wait for ApiServiceProvider to process the token
        const authReady = await authReadyPromise;
        if (!authReady) {
          console.warn(
            "Auth ready event not received within timeout, proceeding anyway",
          );
        }

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
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
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
