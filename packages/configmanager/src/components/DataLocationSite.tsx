import React from "react";
import { UserSelections, ElectronAPI } from "../utils/electron";

interface DataLocationSiteProps {
  userSelections: UserSelections;
  onDataLocationChange: (path: string) => void;
  electronAPI: ElectronAPI | undefined;
}

export const DataLocationSite: React.FC<DataLocationSiteProps> = ({
  userSelections,
  onDataLocationChange,
  electronAPI,
}) => {
  const handleSelectDirectory = async () => {
    if (electronAPI && electronAPI.selectDirectory) {
      try {
        const path = await electronAPI.selectDirectory();
        if (path) {
          onDataLocationChange(path);
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
      <h2>Data Location</h2>
      <p>
        Please select the directory where the application data will be stored.
      </p>
      <button
        type="button"
        className="btn btn-secondary mb-2"
        onClick={handleSelectDirectory}
      >
        Select Directory
      </button>
      <p className="mt-2">
        Selected:{" "}
        <strong id="data-path-display">
          {userSelections.dataLocation || "Not selected"}
        </strong>
      </p>
    </>
  );
};
