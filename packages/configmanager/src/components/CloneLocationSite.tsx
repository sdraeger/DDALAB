import React from "react";
import { UserSelections, ElectronAPI } from "../utils/electron";

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
        Please select the directory where the DDALAB setup repository will be
        cloned. This directory should be empty and will contain the Docker
        Compose files and configuration.
      </p>
      <div className="alert alert-info">
        <strong>Note:</strong> This is different from your data location. The
        clone location contains the setup files (docker-compose.yml, etc.),
        while your data location ({userSelections.dataLocation}) is where your
        application data will be stored.
      </div>
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
