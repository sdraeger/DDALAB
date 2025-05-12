import React, { useState, useEffect, useRef } from "react";
import type { ElectronAPI, UserSelections } from "../utils";
import { app } from "electron";

interface ControlPanelSiteProps {
  electronAPI?: ElectronAPI;
  userSelections: UserSelections; // To access setupPath (dataLocation)
}

const ControlPanelSite: React.FC<ControlPanelSiteProps> = ({
  electronAPI,
  userSelections,
}) => {
  const [dockerStatus, setDockerStatus] = useState<string>("Unknown");
  const [dockerLogs, setDockerLogs] = useState<string[]>([]);
  const [isTraefikHealthy, setIsTraefikHealthy] = useState<boolean>(false);
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
      setIsTraefikHealthy(true);
      setDockerStatus("Running (Services Healthy)");
    });

    // Listener for Docker status updates from main.ts (e.g., starting, stopping, error during these phases)
    const removeStatusListener = electronAPI.onDockerStatusUpdate?.(
      (statusUpdate) => {
        console.log("[ControlPanelSite] Docker Status Update:", statusUpdate);
        // Example: { type: 'info', message: 'Starting Docker services...' }
        //          { type: 'error', message: 'Failed to start...' }
        //          { type: 'success', message: 'Docker services stopped.'}
        setDockerLogs((prev) => [
          ...prev,
          `[${statusUpdate.type.toUpperCase()}] ${statusUpdate.message}`,
        ]);

        // More specific status updates based on messages
        const msgLc = statusUpdate.message.toLowerCase();
        if (statusUpdate.type === "info") {
          if (msgLc.includes("starting")) setDockerStatus("Starting...");
          else if (msgLc.includes("stopping")) setDockerStatus("Stopping...");
          else if (msgLc.includes("checking traefik health"))
            setDockerStatus("Running (Checking Health)");
        } else if (statusUpdate.type === "success") {
          if (msgLc.includes("started")) setDockerStatus("Running");
          // General running, health check will refine
          else if (msgLc.includes("stopped")) {
            setDockerStatus("Stopped");
            setIsTraefikHealthy(false);
          }
        } else if (statusUpdate.type === "error") {
          setDockerStatus("Error");
          setIsTraefikHealthy(false);
        }
      }
    );

    // Listener for bulk log updates (e.g., from getDockerLogs)
    const removeLogUpdateListener = electronAPI.onDockerLogUpdate?.(
      (logUpdate) => {
        console.log("[ControlPanelSite] Docker Log Update:", logUpdate);
        // Example: { type: 'success', message: 'Logs fetched.', logs: 'log line 1\nlog line 2' }
        //          { type: 'error', message: 'Error fetching logs' }
        let logsToAdd = `[${logUpdate.type.toUpperCase()}] ${
          logUpdate.message
        }`;
        if (logUpdate.logs) {
          logsToAdd += `\n--- Begin Fetched Logs ---\n${logUpdate.logs}\n--- End Fetched Logs ---`;
        }
        setDockerLogs((prev) => [...prev, logsToAdd]);
      }
    );

    // Initial status check (optional but can be useful)
    // electronAPI?.getDockerStatus?.().then(status => { ... });

    return () => {
      removeReadyListener?.();
      removeStatusListener?.();
      removeLogUpdateListener?.();
    };
  }, [electronAPI]);

  const handleStartDDALAB = async () => {
    if (!electronAPI || !electronAPI.startDockerCompose) return;
    setDockerLogs((prev) => [
      ...prev,
      `[ACTION] Attempting to start DDALAB services... (${new Date().toLocaleTimeString()})`,
    ]);
    // Status will be updated by onDockerStatusUpdate and onAllServicesReady
    setIsTraefikHealthy(false); // Reset health status on start attempt
    try {
      await electronAPI.startDockerCompose();
    } catch (error: any) {
      console.error(
        "[ControlPanelSite] Error sending startDDALAB command:",
        error
      );
      setDockerStatus("Error starting");
      setDockerLogs((prev) => [
        ...prev,
        `[ERROR] Failed to send start command: ${error.message}`,
      ]);
    }
  };

  const handleStopDDALAB = async () => {
    if (!electronAPI || !electronAPI.stopDockerCompose) return;
    setDockerLogs((prev) => [
      ...prev,
      `[ACTION] Attempting to stop DDALAB services... (${new Date().toLocaleTimeString()})`,
    ]);
    // Status will be updated by onDockerStatusUpdate
    try {
      await electronAPI.stopDockerCompose();
    } catch (error: any) {
      console.error(
        "[ControlPanelSite] Error sending stopDDALAB command:",
        error
      );
      setDockerStatus("Error stopping");
      setDockerLogs((prev) => [
        ...prev,
        `[ERROR] Failed to send stop command: ${error.message}`,
      ]);
    }
  };

  const handleFetchLogs = async () => {
    if (!electronAPI || !electronAPI.getDockerLogs) return;
    setDockerLogs((prev) => [
      ...prev,
      `[ACTION] Fetching recent logs... (${new Date().toLocaleTimeString()})`,
    ]);
    try {
      await electronAPI.getDockerLogs(); // Triggers "docker-log-update" event caught by listener
    } catch (error: any) {
      console.error(
        "[ControlPanelSite] Error calling getDockerLogs command:",
        error
      );
      setDockerLogs((prev) => [
        ...prev,
        `[ERROR] Failed to send fetch logs command: ${error.message}`,
      ]);
    }
  };

  return (
    <div className="container mt-4 site-container">
      <h2 className="mb-3">DDALAB Control Panel</h2>
      <p>
        Manage your DDALAB instance, configured at:{" "}
        <small>
          <code>{userSelections.dataLocation || "Unknown path"}</code>
        </small>
      </p>

      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Controls</h5>
          <button
            className="btn btn-success me-2"
            onClick={handleStartDDALAB}
            disabled={
              dockerStatus.includes("Running") || dockerStatus === "Starting..."
            }
          >
            Start DDALAB
          </button>
          <button
            className="btn btn-danger me-2"
            onClick={handleStopDDALAB}
            disabled={
              dockerStatus === "Stopped" ||
              dockerStatus === "Stopping..." ||
              dockerStatus === "Unknown" ||
              dockerStatus === "Error"
            }
          >
            Stop DDALAB
          </button>
          <button className="btn btn-info" onClick={handleFetchLogs}>
            Fetch Recent Logs
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
              dockerLogs.map((log, index) => <div key={index}>{log}</div>)
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

export default ControlPanelSite;
