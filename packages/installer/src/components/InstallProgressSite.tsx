import React, { useState, useEffect, useRef, useCallback } from "react";
import { UserSelections, ElectronAPI } from "../utils";
import { formatTimestamp } from "../utils";

interface InstallProgressSiteProps {
  userSelections: UserSelections;
  electronAPI: ElectronAPI | undefined;
}

const InstallProgressSite: React.FC<InstallProgressSiteProps> = ({
  userSelections,
  electronAPI,
}) => {
  const [dockerIsRunning, setDockerIsRunning] = useState<boolean | null>(null);
  const [deleteVolumesOnStop, setDeleteVolumesOnStop] = useState(false);
  const [isLoadingDockerAction, setIsLoadingDockerAction] = useState(false);
  const [allServicesReady, setAllServicesReady] = useState(false);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const [dockerLogs, setDockerLogs] = useState<
    Array<{ type: string; message: string; timestamp: string }>
  >([]);
  const addDockerLog = useCallback(
    (type: "stdout" | "stderr" | "info" | "error", message: string) => {
      setDockerLogs((prev) => [
        ...prev,
        { type, message, timestamp: formatTimestamp() },
      ]);
    },
    []
  );

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [userSelections.installationLog, autoScroll]);

  useEffect(() => {
    if (!electronAPI) return;

    let dockerLogListenerCleanup: (() => void) | undefined;
    let allServicesReadyCleanup: (() => void) | undefined;

    const checkDockerStatusAndLogs = async () => {
      try {
        setIsLoadingDockerAction(true);
        const status = await electronAPI.getDockerStatus();
        setDockerIsRunning(status);
        addDockerLog(
          "info",
          `Initial Docker status: ${status ? "Running" : "Stopped"}`
        );

        const recentLogs = await electronAPI.getDockerLogs();
        if (recentLogs) {
          addDockerLog("info", "--- Previous Docker Logs Start ---");
          recentLogs.split("\n").forEach((line) => {
            if (line.trim()) addDockerLog("stdout", line);
          });
          addDockerLog("info", "--- Previous Docker Logs End ---");
        }
      } catch (error) {
        addDockerLog(
          "error",
          `Error fetching initial Docker status: ${(error as Error).message}`
        );
        setDockerIsRunning(false);
      } finally {
        setIsLoadingDockerAction(false);
      }
    };

    if (electronAPI.onDockerLogUpdate) {
      dockerLogListenerCleanup = electronAPI.onDockerLogUpdate((logEntry) => {
        addDockerLog(
          logEntry.type as "stdout" | "stderr" | "info" | "error",
          logEntry.message
        );
      });
    } else {
      console.warn(
        "InstallProgressSite: electronAPI.onDockerLogUpdate is not defined."
      );
    }

    if (electronAPI.onAllServicesReady) {
      allServicesReadyCleanup = electronAPI.onAllServicesReady(() => {
        addDockerLog(
          "info",
          "🎉 All essential Docker services are up and running! Traefik is healthy."
        );
        setAllServicesReady(true);
        setDockerIsRunning(true);
        setIsLoadingDockerAction(false);
      });
    } else {
      console.warn(
        "InstallProgressSite: electronAPI.onAllServicesReady is not defined."
      );
    }

    return () => {
      if (dockerLogListenerCleanup) {
        dockerLogListenerCleanup();
      }
      if (allServicesReadyCleanup) {
        allServicesReadyCleanup();
      }
    };
  }, [electronAPI, addDockerLog]);

  const handleStartDocker = async () => {
    if (!electronAPI || isLoadingDockerAction) return;
    setIsLoadingDockerAction(true);
    setAllServicesReady(false);
    addDockerLog("info", "Attempting to start Docker services...");
    try {
      const success = await electronAPI.startDockerCompose();
      if (success) {
        addDockerLog(
          "info",
          "Docker services initiation command sent. Monitoring Traefik health from backend..."
        );
      } else {
        addDockerLog(
          "error",
          "Failed to initiate Docker services. Check logs for details."
        );
        setDockerIsRunning(false);
        setIsLoadingDockerAction(false);
      }
    } catch (err) {
      addDockerLog(
        "error",
        `Error initiating Docker: ${(err as Error).message}`
      );
      setDockerIsRunning(false);
      setIsLoadingDockerAction(false);
    }
  };

  const handleStopDocker = async () => {
    if (!electronAPI || !dockerIsRunning) return;
    setIsLoadingDockerAction(true);
    addDockerLog(
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
        addDockerLog("info", "Docker services stopped successfully.");
      } else {
        addDockerLog(
          "error",
          "Failed to stop Docker services. Check logs for details."
        );
      }
    } catch (err) {
      addDockerLog("error", `Error stopping Docker: ${(err as Error).message}`);
    } finally {
      setIsLoadingDockerAction(false);
    }
  };

  return (
    <>
      <h2>Initial Setup Progress</h2>

      <div
        className="logs-container mb-3"
        ref={logContainerRef}
        style={{
          height: "200px",
          overflowY: "auto",
          border: "1px solid #ccc",
          padding: "10px",
          backgroundColor: "#f8f9fa",
        }}
      >
        {userSelections.installationLog &&
        userSelections.installationLog.length > 0 ? (
          userSelections.installationLog.map((log, index) => (
            <div key={index} className="log-message">
              {log}
            </div>
          ))
        ) : (
          <p>Waiting for installation to start...</p>
        )}
      </div>
      <label>
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(e) => setAutoScroll(e.target.checked)}
        />{" "}
        Autoscroll Logs
      </label>

      <hr />
      <div className="docker-management-section mt-4 p-3 border rounded">
        <h4>Docker Service Management (Live Status)</h4>
        <p className="text-muted small">
          This section shows live Docker status. Full controls are in the
          Control Panel after setup.
        </p>

        <h5>Docker Activity:</h5>
        <div
          className="logs-container mb-3"
          style={{
            height: "150px",
            overflowY: "auto",
            border: "1px solid #ccc",
            padding: "10px",
            backgroundColor: "#f0f0f0",
          }}
        >
          {dockerLogs.length > 0 ? (
            dockerLogs.map((log, index) => (
              <div key={index} className={`log-message log-${log.type}`}>
                <span className="log-timestamp">[{log.timestamp}] </span>
                {log.message}
              </div>
            ))
          ) : (
            <p>No Docker activity to display yet.</p>
          )}
        </div>

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
    </>
  );
};

export default InstallProgressSite;
