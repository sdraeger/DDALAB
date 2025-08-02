import React, { useEffect, useRef } from "react";
import { ElectronAPI, UserSelections } from "../utils/electron";
import { useDockerState } from "../hooks/useDockerState";

interface ControlPanelSiteProps {
  electronAPI?: ElectronAPI;
  userSelections: UserSelections;
}

export const ControlPanelSite: React.FC<ControlPanelSiteProps> = ({
  electronAPI,
  userSelections,
}) => {
  const {
    dockerStatus,
    dockerLogs,
    isTraefikHealthy,
    servicesReady,
    statusUpdate,
    logUpdate,
    addActionLog,
    addErrorLog,
    canStart,
    canStop,
    startDocker,
    stopDocker,
    dockerStarted,
    dockerStopped,
  } = useDockerState();

  const logsEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [dockerLogs]);

  useEffect(() => {
    if (!electronAPI) return;

    // Listener for Traefik/all services ready
    const removeReadyListener = electronAPI.onAllServicesReady?.(() => {
      console.log("[ControlPanelSite] Received ddalab-services-ready.");
      servicesReady();
    });

    return () => {
      removeReadyListener?.();
    };
  }, [electronAPI, servicesReady]);

  // Validate setup when control panel loads
  useEffect(() => {
    const validateSetup = async () => {
      if (!electronAPI?.validateDockerSetup || !userSelections.cloneLocation) return;

      try {
        console.log("[ControlPanelSite] Validating setup on load...");
        const result = await electronAPI.validateDockerSetup(userSelections.cloneLocation);
        if (!result.success && result.needsSetup) {
          console.warn("[ControlPanelSite] Setup validation failed, needs setup:", result.message);
          addErrorLog(`Setup validation failed: ${result.message}`);
        } else {
          console.log("[ControlPanelSite] Setup validation successful");
        }
      } catch (error) {
        console.error("[ControlPanelSite] Setup validation error:", error);
        addErrorLog(`Setup validation error: ${error}`);
      }
    };

    validateSetup();
  }, [electronAPI, userSelections.cloneLocation, addErrorLog]);

  const handleStartDDALAB = async () => {
    if (!electronAPI || !electronAPI.startDockerCompose) return;

    // Transition state machine to starting state
    startDocker();
    addActionLog("Attempting to start DDALAB services...");

    try {
      const result = await electronAPI.startDockerCompose();
      console.log("[ControlPanelSite] Start result:", result);
      if (!result) {
        addErrorLog("Start operation failed");
      } else {
        // Start log streaming after successful start
        try {
          await electronAPI.getDockerLogs();
          addActionLog("Log streaming started");
        } catch (error) {
          console.warn("[ControlPanelSite] Failed to start log streaming:", error);
        }
      }
    } catch (error: any) {
      console.error(
        "[ControlPanelSite] Error sending startDDALAB command:",
        error
      );
      addErrorLog(`Failed to send start command: ${error.message}`);
    }
  };

  const handleStopDDALAB = async () => {
    console.log("[ControlPanelSite] electronAPI:", electronAPI);
    console.log(
      "[ControlPanelSite] electronAPI keys:",
      electronAPI ? Object.keys(electronAPI) : "electronAPI is null/undefined"
    );
    console.log("[ControlPanelSite] window.electronAPI:", window.electronAPI);
    console.log(
      "[ControlPanelSite] window.electronAPI keys:",
      window.electronAPI
        ? Object.keys(window.electronAPI)
        : "window.electronAPI is null/undefined"
    );

    if (!electronAPI || !electronAPI.stopDockerCompose) {
      console.error(
        "[ControlPanelSite] electronAPI or stopDockerCompose not available"
      );
      return;
    }

    // Transition state machine to stopping state
    stopDocker();
    addActionLog("Attempting to stop DDALAB services...");

    try {
      const result = await electronAPI.stopDockerCompose();

      if (!result) {
        addErrorLog("Stop operation failed");
      } else {
        console.log("[ControlPanelSite] Stop operation succeeded");
        addActionLog("Services stopped successfully");
      }
    } catch (error: any) {
      console.error(
        "[ControlPanelSite] Error sending stopDDALAB command:",
        error
      );
      addErrorLog(`Failed to send stop command: ${error.message}`);
    }
  };

  return (
    <div className="container mt-4 site-container">
      <h2 className="mb-3">DDALAB Control Panel</h2>
      <p>
        Manage your DDALAB instance, configured at:{" "}
        <small>
          <code>{userSelections.cloneLocation || "Unknown path"}</code>
        </small>
      </p>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Controls</h5>
          <button
            className="btn btn-success me-2"
            onClick={handleStartDDALAB}
            disabled={!canStart()}
          >
            {dockerStatus.includes("Starting") ||
              dockerStatus.includes("Checking Health") ? (
              <span
                className="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
              ></span>
            ) : (
              <></>
            )}
            Start DDALAB
          </button>
          <button className="btn btn-danger me-2" onClick={handleStopDDALAB} disabled={!canStop()}>
            {dockerStatus.includes("Stopping") ? (
              <span
                className="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
              ></span>
            ) : (
              <></>
            )}
            Stop DDALAB
          </button>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Status</h5>
          <p className="card-text">
            Application Status: <strong>{dockerStatus}</strong>
          </p>
          {(dockerStatus.includes("Running") ||
            dockerStatus.includes("Checking Health")) && (
              <p className="card-text">
                Services Health (Traefik):{" "}
                <strong
                  className={isTraefikHealthy ? "text-success" : "text-warning"}
                >
                  {isTraefikHealthy ? "Healthy" : "Pending/Unhealthy..."}
                </strong>
              </p>
            )}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h5 className="card-title">Event Log</h5>
          <div
            id="logs-output"
            style={{
              height: "300px",
              overflowY: "scroll",
              backgroundColor: "#f8f9fa",
              border: "1px solid #ced4da",
              padding: "10px",
              fontSize: "0.85em",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {dockerLogs.length > 0 ? (
              dockerLogs.map((log: string, index: number) => (
                <div key={index}>{log}</div>
              ))
            ) : (
              <p>
                No events yet. Use controls to start/stop DDALAB or fetch logs.
              </p>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
