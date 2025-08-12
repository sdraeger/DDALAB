"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Widget,
  SerializableWidget,
} from "shared/components/dashboard/DashboardGrid";
import { Button } from "shared/components/ui/button";
import { ArrowLeft, RotateCcw, AlertCircle } from "lucide-react";
import { usePopoutDataSync } from "shared/hooks/usePopoutDataSync";
import { usePopoutAuth } from "shared/hooks/usePopoutAuth";
import { createWidgetContent } from "shared/lib/utils/widgetFactory";
import { setError } from "shared/index";

interface PoppedOutWidgetPageProps {}

export default function PoppedOutWidgetPage({}: PoppedOutWidgetPageProps) {
  const params = useParams();
  const router = useRouter();
  const [widget, setWidget] = useState<Widget | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const widgetId = params?.id as string;

  // Use the popout data sync hook
  const {
    isDataRestored,
    error: syncError,
    isPopout,
  } = usePopoutDataSync({
    widgetId,
    isPopout: true,
    onDataRestored: () => {
      console.log("[PopoutWidget] Data restoration completed");
    },
    onError: (error) => {
      console.error("[PopoutWidget] Data sync error:", error);
      setInitError(error);
    },
  });

  // Use the popout authentication hook
  const { isAuthenticated, tokenInfo, isRefreshing, authState } = usePopoutAuth(
    {
      widgetId,
      isPopout: true,
      onAuthError: (error) => {
        console.error("[PopoutWidget] Authentication error:", error);
        setInitError(`Authentication failed: ${error}`);
      },
      onTokenRefresh: (token) => {
        console.log("[PopoutWidget] Authentication token refreshed");
      },
    }
  );

  const error = initError || syncError;

  useEffect(() => {
    if (!widgetId) {
      setInitError("Widget ID not provided");
      return;
    }

    const initializeWidget = async () => {
      try {
        // Get enhanced widget data from localStorage
        const storageKey = `popped-widget-${widgetId}`;
        const storedWidget = localStorage.getItem(storageKey);

        if (!storedWidget) {
          setInitError(
            "Widget data not found. Please ensure the widget was properly popped out from the main dashboard."
          );
          return;
        }

        const parsedData = JSON.parse(storedWidget);
        console.log("[PopoutWidget] Loaded widget data:", {
          hasPlotState: !!parsedData.plotsState,
          hasAuthToken: !!parsedData.authToken,
          hasSessionData: !!parsedData.sessionData,
          isCompressed: parsedData._compressed,
          timestamp: parsedData.timestamp,
        });

        // Decompress data if needed
        const decompressedData = await decompressWidgetData(parsedData);

        // Initialize Redux store with transferred state if available
        if (decompressedData.plotsState && typeof window !== "undefined") {
          const reduxStore = (window as any).__REDUX_STORE__;
          if (reduxStore) {
            // Dispatch actions to restore plot state
            const { dispatch } = reduxStore;

            // Restore current file path
            if (decompressedData.currentFilePath) {
              dispatch({
                type: "plots/setCurrentFilePath",
                payload: decompressedData.currentFilePath,
              });
            }

            // Restore plot states
            Object.entries(decompressedData.plotsState.byFilePath).forEach(
              ([filePath, plotState]) => {
                dispatch({
                  type: "plots/ensurePlotState",
                  payload: filePath,
                });

                // Restore plot data (this would be enhanced to fetch full data if compressed)
                if (plotState) {
                  dispatch({
                    type: "plots/restorePlotState",
                    payload: { filePath, plotState },
                  });
                }
              }
            );

            console.log(
              "[PopoutWidget] Redux state restored from parent window"
            );
          }
        }

        // Set up authentication context if available
        if (decompressedData.sessionData && typeof window !== "undefined") {
          // Store session data for API requests
          sessionStorage.setItem(
            "popout-session",
            JSON.stringify(decompressedData.sessionData)
          );
          console.log("[PopoutWidget] Session data restored");
        }

        // Reconstruct the widget with enhanced content
        const reconstructedWidget: Widget = {
          id: decompressedData.id,
          title: decompressedData.title,
          position: decompressedData.position,
          size: decompressedData.size,
          type: decompressedData.type,
          isPopOut: true,
          content: createWidgetContent(decompressedData.type, widgetId, true), // Pass type, widgetId, and isPopout flag
        };

        setWidget(reconstructedWidget);
        console.log("[PopoutWidget] Widget initialized successfully");
      } catch (err) {
        console.error("Error initializing popout widget:", err);
        setError(
          "Failed to initialize widget. The data may be corrupted or incompatible."
        );
      }
    };

    initializeWidget();

    // Listen for updates from parent window
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `popped-widget-${widgetId}` && e.newValue) {
        try {
          const updatedData = JSON.parse(e.newValue);
          console.log("[PopoutWidget] Received data update from parent");

          // Update widget with new data
          const reconstructedWidget: Widget = {
            id: updatedData.id,
            title: updatedData.title,
            position: updatedData.position,
            size: updatedData.size,
            type: updatedData.type,
            isPopOut: true,
            content: createWidgetContent(updatedData.type, widgetId, true),
          };
          setWidget(reconstructedWidget);
        } catch (err) {
          console.error("Failed to parse updated widget data", err);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [widgetId]);

  // Data decompression utility (same as in dashboard)
  async function decompressWidgetData(compressedData: any): Promise<any> {
    try {
      if (!compressedData._compressed) {
        return compressedData;
      }

      console.log("[PopoutWidget] Decompressing widget data");

      const decompressed = {
        ...compressedData,
        _decompressed: true,
      };

      // Mark EDF data as needing full data fetch
      if (decompressed.plotsState?.byFilePath) {
        Object.entries(decompressed.plotsState.byFilePath).forEach(
          ([filePath, plotState]: [string, any]) => {
            if (plotState.edfData?._compressed) {
              plotState.edfData._needsFullData = true;
              // Use sample data for immediate display
              if (plotState.edfData._sampleData) {
                plotState.edfData.data = plotState.edfData._sampleData;
              }
            }
          }
        );
      }

      return decompressed;
    } catch (error) {
      console.error("Error decompressing widget data:", error);
      return compressedData;
    }
  }

  const handleSwapIn = () => {
    // Signal to parent window to swap the widget back in
    if (window.opener && widget) {
      window.opener.postMessage(
        {
          type: "SWAP_IN_WIDGET",
          widgetId: widget.id,
        },
        window.location.origin
      );
      window.close();
    } else {
      // Fallback: redirect to dashboard
      router.push("/dashboard");
    }
  };

  // Show error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <div className="text-destructive text-lg font-medium">Error</div>
          <div className="text-muted-foreground max-w-md">{error}</div>
          <div className="space-y-2">
            <Button onClick={() => router.push("/dashboard")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Return to Dashboard
            </Button>
            <div className="text-xs text-muted-foreground">
              Make sure the widget was properly popped out from the main
              dashboard
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while data is being restored
  if (!isDataRestored || !widget || !isAuthenticated) {
    const getLoadingMessage = () => {
      if (!isDataRestored) return "Restoring data...";
      if (!isAuthenticated) return "Authenticating...";
      return "Loading widget...";
    };

    const getLoadingDescription = () => {
      if (!isDataRestored)
        return "Synchronizing plot state and authentication data from main window";
      if (!isAuthenticated) return "Establishing secure authentication context";
      return "Please wait while the widget initializes";
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <div className="text-lg font-medium">{getLoadingMessage()}</div>
          <div className="text-muted-foreground">{getLoadingDescription()}</div>
          {isRefreshing && (
            <div className="text-xs text-blue-600">
              Refreshing authentication token...
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/5">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{widget.title}</h1>
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
            Pop-out Widget
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSwapIn}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Swap Back to Dashboard
          </Button>
          <Button
            onClick={() => router.push("/dashboard")}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Button>
        </div>
      </div>

      {/* Widget Content */}
      <div className="flex-1 p-6">
        <div className="h-full bg-background border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="h-full p-4 overflow-auto">{widget.content}</div>
        </div>
      </div>
    </div>
  );
}
