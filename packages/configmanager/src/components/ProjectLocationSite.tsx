import React, { useEffect, useState } from "react";
import { UserSelections, ElectronAPI } from "../utils/electron";
import { logger } from '../utils/logger-client';

const CONFIG_MANAGER_STATE_FILE_NAME = "configmanager-state.json";
const DDALAB_SETUP_DIR_NAME = "ddalab-setup-data";

interface ProjectLocationSiteProps {
  userSelections: UserSelections;
  onProjectLocationChange: (path: string) => void;
  electronAPI: ElectronAPI | undefined;
}

interface LocationOption {
  name: string;
  path: string;
  description: string;
  icon: string;
}

export const ProjectLocationSite: React.FC<ProjectLocationSiteProps> = ({
  userSelections,
  onProjectLocationChange,
  electronAPI,
}) => {
  const [configManagerStateFilePath, setConfigManagerStateFilePath] = useState<string | null>(null);
  const [defaultLocations, setDefaultLocations] = useState<LocationOption[]>([]);
  const [customPath, setCustomPath] = useState<string>("");
  const [existingInstallation, setExistingInstallation] = useState<{
    found: boolean;
    path: string;
    showDialog: boolean;
  }>({ found: false, path: "", showDialog: false });
  const [platform, setPlatform] = useState<string>("");

  useEffect(() => {
    const initializeLocations = async () => {
      if (electronAPI) {
        try {
          // Get platform info
          const platformInfo = await electronAPI.getPlatform?.();
          setPlatform(platformInfo || "");

          // Get home directory
          const homeDir = await electronAPI.getHomeDirectory?.();
          if (homeDir) {
            const locations: LocationOption[] = [];

            // OS-specific default locations
            if (platformInfo === "darwin") {
              locations.push(
                {
                  name: "Home",
                  path: `${homeDir}/DDALAB`,
                  description: "In your home directory",
                  icon: "bi-house"
                },
                {
                  name: "Documents",
                  path: `${homeDir}/Documents/DDALAB`,
                  description: "Recommended location in your Documents folder",
                  icon: "bi-folder2-open"
                },
                {
                  name: "Developer",
                  path: `${homeDir}/Developer/DDALAB`,
                  description: "For development projects",
                  icon: "bi-code-slash"
                }
              );
            } else if (platformInfo === "win32") {
              locations.push(
                {
                  name: "Documents",
                  path: `${homeDir}\\Documents\\DDALAB`,
                  description: "Recommended location in your Documents folder",
                  icon: "bi-folder2-open"
                },
                {
                  name: "Projects",
                  path: `${homeDir}\\Projects\\DDALAB`,
                  description: "For your project files",
                  icon: "bi-folder"
                }
              );
            } else {
              // Linux/Unix
              locations.push(
                {
                  name: "Home",
                  path: `${homeDir}/DDALAB`,
                  description: "In your home directory",
                  icon: "bi-house"
                },
                {
                  name: "Projects",
                  path: `${homeDir}/Projects/DDALAB`,
                  description: "For your project files",
                  icon: "bi-folder"
                }
              );
            }

            setDefaultLocations(locations);

            // Check for existing installations
            for (const location of locations) {
              const exists = await electronAPI.checkDirectoryExists?.(location.path);
              if (exists) {
                // Check if it contains DDALAB files
                const hasDockerCompose = await electronAPI.checkFileExists?.(`${location.path}/docker-compose.yml`);
                if (hasDockerCompose) {
                  setExistingInstallation({
                    found: true,
                    path: location.path,
                    showDialog: false
                  });
                  break;
                }
              }
            }
          }

          // Get config manager state
          const state = await electronAPI.getConfigManagerState?.();
          if (state?.setupPath) {
            const userDataPath = await electronAPI.getUserDataPath?.();
            if (userDataPath) {
              const fullPath = userDataPath + '/' + CONFIG_MANAGER_STATE_FILE_NAME;
              setConfigManagerStateFilePath(fullPath);
            }
          }
        } catch (error) {
          logger.error('Error initializing locations', error);
        }
      }
    };

    initializeLocations();
  }, [electronAPI]);

  const handleLocationSelect = (path: string) => {
    if (existingInstallation.found && existingInstallation.path === path) {
      setExistingInstallation({ ...existingInstallation, showDialog: true });
    } else {
      onProjectLocationChange(path);
    }
  };

  const handleCustomDirectory = async () => {
    if (electronAPI && electronAPI.selectDirectory) {
      try {
        const path = await electronAPI.selectDirectory();
        if (path) {
          // Check if selected path has existing installation
          const hasDockerCompose = await electronAPI.checkFileExists?.(`${path}/docker-compose.yml`);
          if (hasDockerCompose) {
            setExistingInstallation({
              found: true,
              path: path,
              showDialog: true
            });
          } else {
            // Append DDALAB to the selected path
            const projectPath = path + (path.endsWith('/') || path.endsWith('\\') ? '' : '/') + 'DDALAB';
            onProjectLocationChange(projectPath);
          }
        }
      } catch (error) {
        logger.error('Error selecting directory', error);
        // TODO: Show user-friendly UI notification instead of alert
      }
    }
  };

  const handleExistingInstallation = (useExisting: boolean) => {
    if (useExisting) {
      onProjectLocationChange(existingInstallation.path);
    } else {
      // Create a new path with timestamp
      const timestamp = new Date().toISOString().slice(0, 10);
      const newPath = `${existingInstallation.path}-${timestamp}`;
      onProjectLocationChange(newPath);
    }
    setExistingInstallation({ ...existingInstallation, showDialog: false });
  };

  return (
    <>
      <h2>Project Location</h2>
      <p className="mb-4">
        Choose where DDALAB will be installed. The installer will create the necessary 
        folders and files for your Docker deployment.
      </p>

      <div className="row mb-4">
        <div className="col-12">
          <h5 className="mb-3">Recommended Locations</h5>
          <div className="list-group">
            {defaultLocations.map((location, index) => (
              <button
                key={index}
                type="button"
                className={`list-group-item list-group-item-action ${
                  userSelections.projectLocation === location.path ? 'active' : ''
                }`}
                onClick={() => handleLocationSelect(location.path)}
              >
                <div className="d-flex align-items-center">
                  <i className={`${location.icon} me-3 fs-4`}></i>
                  <div className="flex-grow-1 text-start">
                    <h6 className="mb-1">{location.name}</h6>
                    <p className="mb-1 small">{location.description}</p>
                    <code className="small">{location.path}</code>
                    {existingInstallation.found && existingInstallation.path === location.path && (
                      <span className="badge bg-warning ms-2">Existing installation found</span>
                    )}
                  </div>
                  {userSelections.projectLocation === location.path && (
                    <i className="bi bi-check-circle-fill text-primary fs-4"></i>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col-12">
          <h5 className="mb-3">Custom Location</h5>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={handleCustomDirectory}
          >
            <i className="bi bi-folder2-open me-2"></i>
            Browse for Custom Location
          </button>
        </div>
      </div>

      {userSelections.projectLocation && (
        <div className="alert alert-success">
          <i className="bi bi-check-circle me-2"></i>
          <strong>Selected Location:</strong> <code>{userSelections.projectLocation}</code>
        </div>
      )}

      <div className="alert alert-info">
        <i className="bi bi-info-circle me-2"></i>
        <strong>Note:</strong> This location will contain Docker configuration files 
        (Dockerfile, docker-compose.yml, etc.). Your data will be stored separately 
        in the location you specified earlier.
      </div>

      {configManagerStateFilePath && (
        <div className="alert alert-secondary mt-2">
          <strong>App State:</strong> Configuration saved at <code>{configManagerStateFilePath}</code>
        </div>
      )}

      {/* Existing Installation Dialog */}
      {existingInstallation.showDialog && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-exclamation-triangle text-warning me-2"></i>
                  Existing Installation Found
                </h5>
              </div>
              <div className="modal-body">
                <p>An existing DDALAB installation was found at:</p>
                <p><code>{existingInstallation.path}</code></p>
                <p>Would you like to:</p>
                <ul>
                  <li><strong>Use existing:</strong> Continue with the current installation</li>
                  <li><strong>Create new:</strong> Create a fresh installation in a new folder</li>
                </ul>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleExistingInstallation(true)}
                >
                  Use Existing
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleExistingInstallation(false)}
                >
                  Create New Installation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};