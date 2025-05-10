import React, { useState, useEffect, useRef, useCallback } from "react";
import type { UserSelections, ElectronAPI } from "../utils";
import { formatTimestamp } from "../utils";

interface InstallProgressSiteProps {
  userSelections: UserSelections;
  electronAPI: ElectronAPI | undefined;
  onInstallComplete: (success: boolean) => void;
}

const InstallProgressSite: React.FC<InstallProgressSiteProps> = ({
  userSelections,
  electronAPI,
  onInstallComplete,
}) => {
  const [logs, setLogs] = useState<
    Array<{
      type: "stdout" | "stderr" | "info" | "error";
      message: string;
      timestamp: string;
    }>
  >([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installSuccess, setInstallSuccess] = useState(false);

  const [dockerIsRunning, setDockerIsRunning] = useState<boolean | null>(null);
  const [deleteVolumesOnStop, setDeleteVolumesOnStop] = useState(false);
  const [isLoadingDockerAction, setIsLoadingDockerAction] = useState(false);
  const [allServicesReady, setAllServicesReady] = useState(false);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLogsVisible, setIsLogsVisible] = useState(false);

  const addLog = useCallback(
    (type: "stdout" | "stderr" | "info" | "error", message: string) => {
      setLogs((prevLogs) => [
        ...prevLogs,
        { type, message, timestamp: formatTimestamp() },
      ]);
    },
    []
  );

  useEffect(() => {
    if (isLogsVisible && autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, isLogsVisible]);

  useEffect(() => {
    const startInstallation = async () => {
      if (!electronAPI || !userSelections || isInstalling || installSuccess)
        return;

      setIsInstalling(true);
      setInstallError(null);
      addLog("info", "Starting initial configuration process...");

      addLog(
        "info",
        "Initial configuration (e.g., .env file saving) assumed to be handled elsewhere or completed."
      );
      addLog("info", "Setup for Docker monitoring and controls is active.");

      setIsInstalling(false);
      setInstallSuccess(true);
      onInstallComplete(true);
    };

    startInstallation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electronAPI, userSelections, addLog, onInstallComplete]);

  useEffect(() => {
    if (!electronAPI) return;

    let logCleanup: (() => void) | undefined;
    let allServicesReadyCleanup: (() => void) | undefined;

    const checkDockerStatusAndLogs = async () => {
      try {
        setIsLoadingDockerAction(true);
        const status = await electronAPI.getDockerStatus();
        setDockerIsRunning(status);
        addLog(
          "info",
          `Initial Docker status: ${status ? "Running" : "Stopped"}`
        );

        const recentLogs = await electronAPI.getDockerLogs();
        if (recentLogs) {
          addLog("info", "--- Previous Logs Start ---");
          recentLogs.split("\n").forEach((line) => {
            if (line.trim()) addLog("stdout", line);
          });
          addLog("info", "--- Previous Logs End ---");
        }
      } catch (error) {
        addLog(
          "error",
          `Error fetching initial Docker status: ${(error as Error).message}`
        );
        setDockerIsRunning(false);
      } finally {
        setIsLoadingDockerAction(false);
      }
    };

    checkDockerStatusAndLogs();

    logCleanup = electronAPI.onDockerLogs((logEntry) => {
      addLog(
        logEntry.type as "stdout" | "stderr" | "info" | "error",
        logEntry.data
      );
    });

    if (electronAPI.onAllServicesReady) {
      allServicesReadyCleanup = electronAPI.onAllServicesReady(() => {
        addLog(
          "info",
          "🎉 All essential Docker services are up and running! Traefik is healthy."
        );
        setAllServicesReady(true);
        setDockerIsRunning(true);
        setIsLoadingDockerAction(false);
      });
    } else {
      console.warn(
        "electronAPI.onAllServicesReady is not defined. Ensure preload.ts is correct and ElectronAPI type is updated."
      );
    }

    return () => {
      if (logCleanup) {
        logCleanup();
      }
      if (allServicesReadyCleanup) {
        allServicesReadyCleanup();
      }
    };
  }, [electronAPI, addLog]);

  const handleStartDocker = async () => {
    if (!electronAPI || isLoadingDockerAction) return;
    setIsLoadingDockerAction(true);
    setAllServicesReady(false);
    addLog("info", "Attempting to start Docker services...");
    try {
      const success = await electronAPI.startDockerCompose();
      if (success) {
        addLog(
          "info",
          "Docker services initiation command sent. Monitoring Traefik health from backend..."
        );
      } else {
        addLog(
          "error",
          "Failed to initiate Docker services. Check logs for details."
        );
        setDockerIsRunning(false);
        setIsLoadingDockerAction(false);
      }
    } catch (err) {
      addLog("error", `Error initiating Docker: ${(err as Error).message}`);
      setDockerIsRunning(false);
      setIsLoadingDockerAction(false);
    }
  };

  const handleStopDocker = async () => {
    if (!electronAPI || !dockerIsRunning) return;
    setIsLoadingDockerAction(true);
    addLog(
      "info",
      `Attempting to stop Docker services... ${
        deleteVolumesOnStop ? "(Deleting volumes)" : ""
      }`
    );
    try {
      const success = await electronAPI.stopDockerCompose(deleteVolumesOnStop);
      if (success) {
        setDockerIsRunning(false);
        setAllServicesReady(false);
        addLog("info", "Docker services stopped successfully.");
      } else {
        addLog(
          "error",
          "Failed to stop Docker services. Check logs for details."
        );
      }
    } catch (err) {
      addLog("error", `Error stopping Docker: ${(err as Error).message}`);
    } finally {
      setIsLoadingDockerAction(false);
    }
  };

  return (
    <>
      <h2>Installation & Docker Management</h2>

      {isInstalling && <p>Initial setup in progress. Please wait...</p>}
      {installError && (
        <p className="alert alert-danger">
          Error during initial setup: {installError}
        </p>
      )}
      {installSuccess && !installError && (
        <p className="alert alert-success">
          Initial setup completed successfully! You can now manage Docker
          services.
        </p>
      )}

      {allServicesReady && (
        <p className="alert alert-success mt-3">
          🎉 Application is fully up and running! Traefik is healthy.
        </p>
      )}
      {!allServicesReady && dockerIsRunning && isLoadingDockerAction && (
        <p className="alert alert-info mt-3">
          Docker services are starting... Waiting for Traefik to become healthy.
        </p>
      )}

      <div className="docker-management-section mt-4 p-3 border rounded">
        <h4>Docker Service Management</h4>
        {dockerIsRunning === null && <p>Checking Docker status...</p>}
        {dockerIsRunning !== null && (
          <p>
            Current Docker Status:
            <span
              className={dockerIsRunning ? "text-success" : "text-danger"}
              style={{ fontWeight: "bold" }}
            >
              {" "}
              {isLoadingDockerAction && !allServicesReady
                ? " (Action in progress...)"
                : allServicesReady
                ? " Running & Ready"
                : dockerIsRunning
                ? " Running (Initializing...)"
                : " Stopped"}
            </span>
          </p>
        )}

        <div className="mb-3">
          <button
            className="btn btn-success me-2"
            onClick={handleStartDocker}
            disabled={
              isLoadingDockerAction ||
              dockerIsRunning === true ||
              dockerIsRunning === null
            }
          >
            <i className="bi bi-play-fill me-1"></i>Start Services
          </button>
          <button
            className="btn btn-danger me-2"
            onClick={handleStopDocker}
            disabled={isLoadingDockerAction || !dockerIsRunning}
          >
            <i className="bi bi-stop-fill me-1"></i>Stop Services
          </button>
          {dockerIsRunning === false && (
            <label className="form-check-label small ms-2">
              <input
                type="checkbox"
                className="form-check-input me-1"
                checked={deleteVolumesOnStop}
                onChange={() => setDeleteVolumesOnStop(!deleteVolumesOnStop)}
              />
              Delete volumes on stop
            </label>
          )}
        </div>
      </div>

      <div className="logs-section mt-4 p-3 border rounded">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h4>Runtime Logs</h4>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setIsLogsVisible(!isLogsVisible)}
            aria-expanded={isLogsVisible}
            aria-controls="collapseLogs"
          >
            {isLogsVisible ? "Hide" : "Show"} Logs
          </button>
        </div>

        {isLogsVisible && (
          <div
            id="collapseLogs"
            ref={logContainerRef}
            className="log-container bg-light p-2 border rounded"
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              fontSize: "0.875em",
            }}
          >
            {logs.length === 0 ? (
              <p className="text-muted fst-italic">No logs to display yet.</p>
            ) : (
              logs.map((log, index) => (
                <div
                  key={index}
                  className={`log-entry log-${log.type}`}
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                >
                  <small className="text-muted me-2">[{log.timestamp}]</small>
                  <span
                    className={
                      {
                        info: "text-primary",
                        stdout: "",
                        stderr: "text-danger",
                        error: "text-danger fw-bold",
                      }[log.type]
                    }
                  >
                    {log.message.trim()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {isLogsVisible && (
          <div className="mt-2 text-end">
            <label className="form-check-label small">
              <input
                type="checkbox"
                className="form-check-input me-1"
                checked={autoScroll}
                onChange={() => setAutoScroll(!autoScroll)}
              />
              Autoscroll
            </label>
          </div>
        )}
      </div>
    </>
  );
};

export default InstallProgressSite;
