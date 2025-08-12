import React, { useEffect, useState } from "react";
import { UserSelections, ElectronAPI } from "../utils/electron";
import path from "path";

const CONFIG_MANAGER_STATE_FILE_NAME = "configmanager-state.json";
const DDALAB_SETUP_DIR_NAME = "ddalab-setup-data";

interface CloneLocationSiteProps {
  userSelections: UserSelections;
  onCloneLocationChange: (path: string) => void;
  electronAPI: ElectronAPI | undefined;
}

export const CloneLocationSite: React.FC<CloneLocationSiteProps> = ({
  userSelections,
  onCloneLocationChange,
  electronAPI,
}) => {
  const [configManagerStateFilePath, setConfigManagerStateFilePath] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfigManagerStatePath = async () => {
      if (electronAPI && electronAPI.getConfigManagerState) {
        try {
          const state = await electronAPI.getConfigManagerState();
          if (state && state.setupPath) {
            // Reconstruct the full path using the same logic as SetupService
            // Assuming app.getPath("userData") is equivalent to electronAPI.getUserDataPath()
            // (which would need to be exposed if not already, but often app.getPath is internal)
            // For now, we will just display the setupPath as it's the most relevant part of the state
            // and the full path is derived from a constant part + setupPath.
            // A more robust solution would be to expose getConfigManagerStateFilePath directly via IPC.
            const userDataPath = await electronAPI.getUserDataPath(); // Assuming this exists or will be added
            if (userDataPath) {
              const fullPath = path.join(userDataPath, CONFIG_MANAGER_STATE_FILE_NAME);
              setConfigManagerStateFilePath(fullPath);
            }
          }
        } catch (error) {
          console.error("Error fetching config manager state:", error);
        }
      }
    };

    fetchConfigManagerStatePath();
  }, [electronAPI]);

  const handleSelectDirectory = async () => {
    if (electronAPI && electronAPI.selectDirectory) {
      try {
        const path = await electronAPI.selectDirectory();
        if (path) {
          onCloneLocationChange(path);
        }
      } catch (error) {
        console.error("Error selecting directory:", error);
        alert("Failed to select directory. See console for details.");
      }
    } else {
      console.error("electronAPI.selectDirectory is not available");
      alert("Error: Directory selection functionality is not available.");
    }
  };

  return (
    <>
      <h2>Clone Location</h2>
      <p>
        Please select the directory where the DDALAB monolithic Docker deployment
        files will be placed. This directory should ideally be empty and will
        contain the `Dockerfile`, `docker-compose.yml`, and configuration for your
        monolithic DDALAB application.
      </p>
      <div className="alert alert-info">
        <strong>Note:</strong> This is different from your data location. The
        deployment location contains the core Docker files (`Dockerfile`,
        `docker-compose.yml`, etc.), while your data location (
        {userSelections.dataLocation}) is where your application data will be stored.
      </div>
      {configManagerStateFilePath && (
        <div className="alert alert-success mt-2">
          <strong>ConfigManager State:</strong> The application state is saved at
          <code>{configManagerStateFilePath}</code>
        </div>
      )}
      <button
        type="button"
        className="btn btn-secondary mb-2"
        onClick={handleSelectDirectory}
      >
        Select Directory
      </button>
      <p className="mt-2">
        Selected:{" "}
        <strong id="clone-path-display">
          {userSelections.cloneLocation || "Not selected"}
        </strong>
      </p>
    </>
  );
};
