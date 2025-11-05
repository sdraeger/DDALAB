"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function PopoutBridgeContent() {
  const searchParams = useSearchParams();
  const windowType = searchParams.get("type");
  const windowId = searchParams.get("id");

  const [isClient, setIsClient] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [currentData, setCurrentData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient || !windowId) return;

    let unlistenData: (() => void) | undefined;
    let unlistenLock: (() => void) | undefined;

    const setupTauriListeners = async () => {
      try {
        const { listen, emit } = await import("@tauri-apps/api/event");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");

        console.log(`Setting up listeners for window: ${windowId}`);

        // Listen for data updates
        unlistenData = await listen(`data-update-${windowId}`, (event: any) => {
          console.log("Received data:", event.payload);
          if (!isLocked) {
            setCurrentData(event.payload.data);
          }
        });

        // Listen for lock state changes
        unlistenLock = await listen(`lock-state-${windowId}`, (event: any) => {
          setIsLocked(event.payload.locked);
        });

        // Setup window controls
        const setupWindowControls = () => {
          const closeBtn = document.getElementById("close-button");
          const minimizeBtn = document.getElementById("minimize-button");
          const lockBtn = document.getElementById("lock-button");

          if (closeBtn) {
            closeBtn.onclick = async () => {
              const currentWindow = getCurrentWindow();
              await currentWindow.close();
            };
          }

          if (minimizeBtn) {
            minimizeBtn.onclick = async () => {
              const currentWindow = getCurrentWindow();
              await currentWindow.minimize();
            };
          }

          if (lockBtn) {
            lockBtn.onclick = async () => {
              const eventName = isLocked
                ? `unlock-window-${windowId}`
                : `lock-window-${windowId}`;
              await emit(eventName);
            };
          }
        };

        setupWindowControls();
      } catch (error) {
        console.error("Failed to setup Tauri listeners:", error);
        setError(`Failed to setup Tauri listeners: ${error}`);
      }
    };

    setupTauriListeners();

    return () => {
      if (unlistenData) unlistenData();
      if (unlistenLock) unlistenLock();
    };
  }, [isClient, windowId, isLocked]);

  const titleMap: Record<string, string> = {
    timeseries: "Time Series Plot",
    "dda-results": "DDA Analysis Results",
    "eeg-visualization": "EEG Visualization",
  };

  const renderContent = () => {
    if (error) {
      return <div className="text-red-600 p-4">{error}</div>;
    }

    if (!currentData) {
      return (
        <div className="flex items-center justify-center h-full text-gray-600">
          Waiting for data...
        </div>
      );
    }

    if (windowType === "timeseries") {
      return renderTimeSeriesContent(currentData);
    } else if (windowType === "dda-results") {
      return renderDDAResultsContent(currentData);
    } else {
      return <div>Unknown window type: {windowType}</div>;
    }
  };

  const renderTimeSeriesContent = (data: any) => {
    if (!data || !data.channels) {
      return <div>No time series data available</div>;
    }

    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-4">Time Series Plot</h2>
        <div className="space-y-2">
          <p>Channels: {data.channels.length}</p>
          <p>Sample Rate: {data.sampleRate} Hz</p>
          <p>Time Window: {data.timeWindow}s</p>
          <p>Data points: {data.data ? data.data.length : 0}</p>
        </div>
      </div>
    );
  };

  const renderDDAResultsContent = (data: any) => {
    if (!data || !data.result) {
      return <div>No DDA results available</div>;
    }

    const result = data.result;
    return (
      <div className="p-4">
        <h2 className="text-lg font-semibold mb-4">DDA Analysis Results</h2>
        <div className="space-y-2">
          <p>Channels: {result.channels ? result.channels.length : 0}</p>
          <p>
            Created:{" "}
            {result.created_at
              ? new Date(result.created_at).toLocaleString()
              : "Unknown"}
          </p>
          <p>Result ID: {result.id}</p>
        </div>
      </div>
    );
  };

  if (!isClient) {
    return <div>Loading...</div>;
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Custom title bar */}
      <div
        className="h-10 bg-gray-100 border-b flex items-center justify-between px-3 select-none"
        data-tauri-drag-region
      >
        <div className="text-sm font-medium text-gray-700">
          {titleMap[windowType || ""] || "DDALAB Popout"}
        </div>

        <div className="flex items-center space-x-1">
          <button
            id="lock-button"
            className="w-7 h-7 rounded hover:bg-gray-200 flex items-center justify-center text-xs"
            title={isLocked ? "Unlock window" : "Lock window"}
          >
            {isLocked ? "🔓" : "🔒"}
          </button>

          <button
            id="minimize-button"
            className="w-7 h-7 rounded hover:bg-gray-200 flex items-center justify-center text-xs"
            title="Minimize"
          >
            −
          </button>

          <button
            id="close-button"
            className="w-7 h-7 rounded hover:bg-red-500 hover:text-white flex items-center justify-center text-xs"
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Lock status indicator */}
      {isLocked && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-3 py-2">
          <div className="flex items-center space-x-2 text-yellow-800 text-sm">
            🔒 <span>Window is locked - not receiving updates</span>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto">{renderContent()}</div>

      {/* Status bar */}
      <div className="h-6 bg-gray-50 border-t flex items-center justify-between px-3 text-xs text-gray-500">
        <div>
          Window ID: {windowId || "Unknown"} | Status:{" "}
          {isLocked ? "Locked" : "Live"}
        </div>
      </div>
    </div>
  );
}

export default function PopoutBridge() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PopoutBridgeContent />
    </Suspense>
  );
}
