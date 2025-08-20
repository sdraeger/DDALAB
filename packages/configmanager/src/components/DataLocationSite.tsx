import React, { useState, useEffect } from "react";
import { UserSelections, ElectronAPI } from "../utils/electron";
import { AllowedDirectoriesSelector } from "./AllowedDirectoriesSelector";
import { DirectoryValidationIndicator } from "./DirectoryValidationIndicator";
import { DirectoryRequirementsModal } from "./DirectoryRequirementsModal";

interface DataLocationSiteProps {
  userSelections: UserSelections;
  onDataLocationChange: (path: string) => void;
  onEnvVariableChange?: (key: string, value: string) => void;
  electronAPI: ElectronAPI | undefined;
}

interface AllowedDirectory {
  path: string;
  containerPath: string;
  permissions: "ro" | "rw";
}

export const DataLocationSite: React.FC<DataLocationSiteProps> = ({
  userSelections,
  onDataLocationChange,
  onEnvVariableChange,
  electronAPI,
}) => {
  const [allowedDirectories, setAllowedDirectories] = useState<AllowedDirectory[]>([]);
  const [showRequirementsModal, setShowRequirementsModal] = useState(true);

  // Parse existing allowedDirs from userSelections if available
  useEffect(() => {
    if (userSelections.envVariables?.DDALAB_ALLOWED_DIRS) {
      const dirs = userSelections.envVariables.DDALAB_ALLOWED_DIRS.split(",").map(dir => {
        const parts = dir.trim().split(":");
        return {
          path: parts[0] || "",
          containerPath: parts[1] || "/app/data",
          permissions: (parts[2] || "rw") as "ro" | "rw"
        };
      });
      setAllowedDirectories(dirs);
    } else if (userSelections.dataLocation) {
      // Initialize with existing dataLocation if available
      setAllowedDirectories([{
        path: userSelections.dataLocation,
        containerPath: "/app/data",
        permissions: "rw"
      }]);
    }
  }, []);

  const handleDirectoriesChange = (directories: AllowedDirectory[]) => {
    setAllowedDirectories(directories);
    
    // Update the main data location with the first directory
    if (directories.length > 0 && directories[0].path) {
      onDataLocationChange(directories[0].path);
    }
    
    // Format and store as DDALAB_ALLOWED_DIRS
    const allowedDirsString = directories
      .filter(dir => dir.path)
      .map(dir => `${dir.path}:${dir.containerPath}:${dir.permissions}`)
      .join(",");
    
    // Update the env variables in userSelections
    if (onEnvVariableChange) {
      onEnvVariableChange("DDALAB_ALLOWED_DIRS", allowedDirsString);
    }
  };

  const hasValidDirectories = allowedDirectories.some(dir => dir.path && dir.containerPath);

  return (
    <>
      <DirectoryRequirementsModal
        show={showRequirementsModal}
        onClose={() => setShowRequirementsModal(false)}
      />
      
      <div className="row">
      <div className="col-lg-8">
        <h2>Data Locations & Permissions</h2>
        <p className="mb-4">
          Configure the directories that DDALAB will be allowed to access. You must select at least one directory
          where application data will be stored. Additional directories can be added for data import/export.
        </p>
        
        <AllowedDirectoriesSelector
          electronAPI={electronAPI}
          initialDirectories={allowedDirectories}
          onChange={handleDirectoriesChange}
          required={true}
        />
        
        <div className="mt-4 p-3 bg-light rounded">
          <h5>Why is this required?</h5>
          <p className="mb-0">
            For security reasons, DDALAB runs in a containerized environment and can only access directories
            you explicitly allow. The first directory will be used as the primary data location where DDALAB
            stores its database, configuration files, and analysis results.
          </p>
        </div>
      </div>
      
      <div className="col-lg-4">
        <div className="sticky-top" style={{ top: '20px' }}>
          <DirectoryValidationIndicator
            directories={allowedDirectories}
            isValid={hasValidDirectories}
            className="mt-4"
          />
        </div>
      </div>
      </div>
    </>
  );
};
