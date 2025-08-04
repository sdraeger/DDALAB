import React, { useEffect, useState } from "react";
import type { ParsedEnvEntry, ElectronAPI, UserSelections } from "./utils/electron";
import {
  WelcomeSite,
  DataLocationSite,
  CloneLocationSite,
  ManualConfigSite,
  DockerConfigSite,
  SummarySite,
  ControlPanelSite,
  ProgressSidebar,
  ControlPanelSidebar,
  ConfigurationEditor,
  SystemInfoModal,
} from "./components";
import { ServiceManagementModal } from "./components/ServiceManagementModal";
import { LogsViewerModal } from "./components/LogsViewerModal";
import { SiteNavigationProvider } from "./context/SiteNavigationProvider";
import { DockerProvider } from "./context/DockerProvider";
import { useSiteNavigation } from "./hooks/useSiteNavigation";
import { useNavigationValidation } from "./hooks/useNavigationValidation";

interface CloneDialog {
  show: boolean;
  targetPath: string;
  message: string;
}

interface CommonProps {
  userSelections: UserSelections;
  onUpdateSelections: (selections: Partial<UserSelections>) => void;
  parsedEnvEntries: ParsedEnvEntry[];
  onUpdateEnvEntries: (entries: ParsedEnvEntry[]) => void;
  onNext: () => void;
  onBack: () => void;
  electronAPI: ElectronAPI | undefined;
}

const CloneDialogModal: React.FC<{
  dialog: CloneDialog;
  isLoading: boolean;
  onClone: () => void;
  onClose: () => void;
}> = ({ dialog, isLoading, onClone, onClose }) => (
  <div className="modal fade show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
    <div className="modal-dialog">
      <div className="modal-content">
        <div className="modal-header">
          <h5 className="modal-title">Setup Directory</h5>
          <button type="button" className="btn-close" onClick={onClose}></button>
        </div>
        <div className="modal-body">
          <p>{dialog.message}</p>
          <p><strong>Target Path:</strong> {dialog.targetPath}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClone}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span
                  className="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-hidden="true"
                />
                Setting up...
              </>
            ) : (
              "Setup Directory"
            )}
          </button>
        </div>
      </div>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const {
    currentSite,
    userSelections,
    parsedEnvEntries,
    installationSuccess,
    goToNextSite,
    goToPreviousSite,
    goToSite,
    updateSelections,
    updateEnvEntries,
    setInstallationSuccess,
  } = useSiteNavigation();

  const [isLoading, setIsLoading] = useState(false);
  const [cloneDialog, setCloneDialog] = useState<CloneDialog | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [showServiceManagement, setShowServiceManagement] = useState(false);
  const [showLogsViewer, setShowLogsViewer] = useState(false);
  const electronAPI = window.electronAPI as ElectronAPI | undefined;

  const {
    isNextButtonEnabled,
    isBackButtonEnabled,
    shouldShowNextButton,
    shouldShowFinishButton,
  } = useNavigationValidation(
    currentSite,
    userSelections,
    parsedEnvEntries,
    isLoading
  );

  const loadEnvVars = async (
    path: string
  ): Promise<ParsedEnvEntry[] | null> => {
    if (!electronAPI?.loadEnvVars) return null;
    try {
      const entries = await electronAPI.loadEnvVars(path);
      if (!entries) return null;
      updateSelections({
        envVariables: Object.fromEntries(
          entries.map(({ key, value }) => [key, value])
        ),
      });
      updateEnvEntries(entries);
      return entries;
    } catch (error) {
      alert("Could not load environment variables.");
      return null;
    }
  };

  const validateDockerSetup = async (path: string): Promise<boolean> => {
    if (!electronAPI || !path) {
      alert("Setup validation not available or no directory selected.");
      return false;
    }
    try {
      const result = await electronAPI.validateDockerSetup(path);
      if (result.success && result.setupPath) {
        updateSelections({
          dataLocation: result.setupPath,
          cloneLocation: result.setupPath,
        });
        return true;
      }
      if (result.needsSetup && result.targetPath) {
        setCloneDialog({
          show: true,
          targetPath: result.targetPath,
          message:
            result.message ||
            `No DDALAB Docker setup found in ${result.targetPath}. Would you like to create the necessary files?`,
        });
      } else {
        alert(result.message || "Failed to validate Docker setup directory.");
      }
      return false;
    } catch (error) {
      alert(`Failed to validate Docker setup: ${String(error)}`);
      return false;
    }
  };

  const executeDockerInstallation = async (): Promise<boolean> => {
    if (!electronAPI || !userSelections.dataLocation) {
      alert("Installation interface not available or no directory selected.");
      return false;
    }
    try {
      if (userSelections.setupType === "docker") {
        if (!userSelections.cloneLocation) {
          alert("Setup location not selected for Docker setup.");
          return false;
        }

        // Construct user configuration from user selections
        const userConfig = {
          dataLocation: userSelections.dataLocation,
          allowedDirs: `${userSelections.dataLocation}:/app/data:rw`,
          webPort: userSelections.webPort || "3000",
          apiPort: userSelections.apiPort || "8001",
          dbPassword: userSelections.dbPassword || "ddalab_password",
          minioPassword: userSelections.minioPassword || "ddalab_password",
          traefikEmail: userSelections.traefikEmail || "admin@ddalab.local",
          useDockerHub: userSelections.useDockerHub !== false, // Default to true
        };

        await electronAPI.setupDockerDeployment(
          userSelections.dataLocation,
          userSelections.cloneLocation,
          userConfig
        );
      } else {
        await electronAPI.saveEnvFile(
          userSelections.dataLocation,
          userSelections.envVariables
        );
        await electronAPI.markSetupComplete(userSelections.dataLocation);
      }

      // Save full state after successful installation
      if (electronAPI?.saveFullState) {
        await electronAPI.saveFullState(
          userSelections.dataLocation,
          userSelections.cloneLocation,
          userSelections,
          currentSite,
          parsedEnvEntries,
          true
        );
      }

      setInstallationSuccess(true);
      return true;
    } catch (error) {
      alert(`Installation failed: ${String(error)}`);
      return false;
    }
  };

  const handleNavigation = async (direction: "next" | "back") => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      if (direction === "back") {
        goToPreviousSite();
        return;
      }

      let canProceed = true;
      switch (currentSite) {
        case "welcome":
          if (!userSelections.setupType) {
            alert("Please select a setup type.");
            canProceed = false;
          } else if (userSelections.setupType === "docker") {
            updateSelections({ envVariables: {} });
          }
          break;
        case "data-location":
          if (!userSelections.dataLocation) {
            alert("Please select a data location.");
            canProceed = false;
          }
          break;
        case "clone-location":
          if (!userSelections.cloneLocation) {
            alert("Please select a setup location.");
            canProceed = false;
          }
          break;
        case "docker-config":
          // For Docker config, we can proceed as long as we have the basic setup
          if (!userSelections.dataLocation || !userSelections.cloneLocation) {
            alert("Please complete the previous steps first.");
            canProceed = false;
          }
          break;
        case "manual-config":
          canProceed = await validateDockerSetup(userSelections.dataLocation);
          break;
        case "summary":
          canProceed = await executeDockerInstallation();
          if (canProceed) {
            // Setup is complete, transition to control panel
            setIsSetupComplete(true);
          }
          break;
      }
      if (canProceed) goToNextSite();
    } catch (error) {
      alert("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupDirectory = async () => {
    if (!cloneDialog?.targetPath || !electronAPI) return;
    setIsLoading(true);
    try {
      // Construct user configuration with default values
      const userConfig = {
        dataLocation: cloneDialog.targetPath,
        allowedDirs: `${cloneDialog.targetPath}:/app/data:rw`,
        webPort: "3000",
        apiPort: "8001",
        dbPassword: "ddalab_password",
        minioPassword: "ddalab_password",
        traefikEmail: "admin@ddalab.local",
        useDockerHub: true,
      };

      const result = await electronAPI.setupDockerDirectory(
        cloneDialog.targetPath,
        userConfig
      );
      if (result.success && result.setupPath) {
        updateSelections({
          dataLocation: result.setupPath,
          cloneLocation: result.setupPath,
        });
        await loadEnvVars(result.setupPath);
        setCloneDialog(null);
        goToNextSite();
      } else {
        alert(result.message || "Failed to setup directory.");
      }
    } catch (error) {
      alert(`Failed to setup directory: ${String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleMenuAction = (data: { action: string; path?: string }) => {
      switch (data.action) {
        case 'new-setup':
          goToSite('welcome');
          updateSelections({});
          updateEnvEntries([]);
          setInstallationSuccess(false);
          break;
        case 'open-setup-directory':
          if (data.path) {
            updateSelections({ dataLocation: data.path, cloneLocation: data.path });
          }
          break;
        case 'restart-setup-wizard':
          goToSite('welcome');
          break;
        case 'reset-all-settings':
          goToSite('welcome');
          updateSelections({});
          updateEnvEntries([]);
          setInstallationSuccess(false);
          break;
        case 'validate-current-setup':
          if (electronAPI?.validateDockerSetup && userSelections.dataLocation) {
            validateDockerSetup(userSelections.dataLocation);
          }
          break;
        case 'start-docker-services':
          if (electronAPI?.startDockerCompose) {
            electronAPI.startDockerCompose();
          }
          break;
        case 'stop-docker-services':
          if (electronAPI?.stopDockerCompose) {
            electronAPI.stopDockerCompose(false);
          }
          break;
        case 'restart-docker-services':
          if (electronAPI?.stopDockerCompose && electronAPI?.startDockerCompose) {
            electronAPI.stopDockerCompose(false).then(() => {
              setTimeout(() => electronAPI.startDockerCompose(), 2000);
            });
          }
          break;
        case 'check-docker-status':
          if (electronAPI?.getDockerStatus) {
            electronAPI.getDockerStatus();
          }
          break;
        case 'view-docker-logs':
          goToSite('control-panel');
          break;
        case 'reset-docker-volumes':
          if (electronAPI?.stopDockerCompose) {
            electronAPI.stopDockerCompose(true);
          }
          break;
        case 'export-configuration':
        case 'import-configuration':
          // These are handled by menu IPC handlers
          break;
        default:
          console.log('Unhandled menu action:', data.action);
      }
    };

    // Listen for menu actions
    if (electronAPI?.onMenuAction) {
      const removeMenuListener = electronAPI.onMenuAction(handleMenuAction);
      
      return () => {
        removeMenuListener();
      };
    }
  }, [electronAPI, goToSite, updateSelections, updateEnvEntries, setInstallationSuccess, userSelections.dataLocation, validateDockerSetup]);

  useEffect(() => {
    const initializeApp = async () => {
      if (!electronAPI?.getConfigManagerState) {
        goToSite("welcome");
        return;
      }
      try {
        const state = await electronAPI.getConfigManagerState();

        // Restore user selections if available
        if (state.userSelections) {
          updateSelections(state.userSelections);
        }

        // Restore navigation state if available
        if (state.currentSite) {
          goToSite(state.currentSite);
        }

        // Restore environment entries if available
        if (state.parsedEnvEntries) {
          updateEnvEntries(state.parsedEnvEntries);
        }

        // Restore installation success state
        if (state.installationSuccess !== undefined) {
          setInstallationSuccess(state.installationSuccess);
        }

        if (state.setupComplete) {
          // Setup is complete, go to control panel and set flag
          setIsSetupComplete(true);
          goToSite("control-panel");
          updateSelections({
            dataLocation: state.dataLocation || state.setupPath,
            cloneLocation: state.cloneLocation || state.setupPath,
          });
        } else {
          // Only go to welcome if no current site is set
          if (!state.currentSite) {
            goToSite("welcome");
          }
        }
      } catch (error) {
        goToSite("welcome");
      }
    };
    initializeApp();
  }, []);

  // Auto-save state when user selections or navigation changes
  useEffect(() => {
    const saveState = async () => {
      if (electronAPI?.saveUserState) {
        try {
          await electronAPI.saveUserState(
            userSelections,
            currentSite,
            parsedEnvEntries,
            installationSuccess
          );
        } catch (error) {
          console.error("Failed to save user state:", error);
        }
      }
    };

    // Debounce state saving to avoid excessive writes
    const timeoutId = setTimeout(saveState, 1000);
    return () => clearTimeout(timeoutId);
  }, [userSelections, currentSite, parsedEnvEntries, installationSuccess, electronAPI]);

  // Control panel sidebar handlers
  const handleEditConfig = () => {
    setShowConfigEditor(true);
  };

  const handleViewLogs = () => {
    setShowLogsViewer(true);
  };

  const handleManageServices = () => {
    setShowServiceManagement(true);
  };

  const handleSystemInfo = () => {
    setShowSystemInfo(true);
  };

  const handleSaveConfiguration = async (selections: Partial<UserSelections>, envEntries: ParsedEnvEntry[]) => {
    try {
      updateSelections(selections);
      updateEnvEntries(envEntries);
      
      // Save to electron store
      if (electronAPI?.saveUserState) {
        await electronAPI.saveUserState(
          { ...userSelections, ...selections },
          currentSite,
          envEntries,
          installationSuccess
        );
      }
      
      // Save env file if needed
      if (electronAPI?.saveEnvFile && userSelections.dataLocation) {
        await electronAPI.saveEnvFile(
          userSelections.dataLocation,
          selections.envVariables || userSelections.envVariables
        );
      }
      
      setShowConfigEditor(false);
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('Failed to save configuration:', error);
      alert('Failed to save configuration. Please try again.');
    }
  };

  const commonProps: CommonProps = {
    userSelections,
    onUpdateSelections: updateSelections,
    parsedEnvEntries,
    onUpdateEnvEntries: updateEnvEntries,
    onNext: () => handleNavigation("next"),
    onBack: () => handleNavigation("back"),
    electronAPI,
  };

  const siteComponents: Record<string, JSX.Element> = {
    welcome: (
      <WelcomeSite
        {...commonProps}
        onSetupTypeChange={(type) => updateSelections({ setupType: type })}
      />
    ),
    "data-location": (
      <DataLocationSite
        {...commonProps}
        onDataLocationChange={(path) =>
          updateSelections({ dataLocation: path })
        }
      />
    ),
    "clone-location": (
      <CloneLocationSite
        {...commonProps}
        onCloneLocationChange={(path) =>
          updateSelections({ cloneLocation: path })
        }
      />
    ),
    "docker-config": (
      <DockerConfigSite
        {...commonProps}
      />
    ),
    "manual-config": (
      <ManualConfigSite
        {...commonProps}
        onEnvVariableChange={(key, value) =>
          updateSelections({
            envVariables: { ...userSelections.envVariables, [key]: value },
          })
        }
        setParsedEnvEntries={updateEnvEntries}
      />
    ),
    summary: <SummarySite {...commonProps} />,
    "control-panel": <ControlPanelSite {...commonProps} />,
  };

  return (
    <div className="app-layout">
      {isSetupComplete ? (
        <ControlPanelSidebar
          isExpanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded(!sidebarExpanded)}
          electronAPI={electronAPI}
          userSelections={userSelections}
          onEditConfig={handleEditConfig}
          onViewLogs={handleViewLogs}
          onManageServices={handleManageServices}
          onSystemInfo={handleSystemInfo}
        />
      ) : (
        <ProgressSidebar
          currentSite={currentSite}
          setupType={userSelections.setupType}
          isExpanded={sidebarExpanded}
          onToggle={() => setSidebarExpanded(!sidebarExpanded)}
          electronAPI={electronAPI}
          isSetupComplete={isSetupComplete}
        />
      )}
      <div className={`main-content ${sidebarExpanded ? 'with-sidebar' : 'with-collapsed-sidebar'}`}>
        <div className="installer-container">
          {siteComponents[currentSite] || <div>Loading...</div>}
          {!isSetupComplete && (
            <footer className="mt-auto pt-3 border-top d-flex justify-content-between">
              <button
                className="btn btn-secondary"
                onClick={() => handleNavigation("back")}
                disabled={!isBackButtonEnabled}
              >
                Back
              </button>
              {(shouldShowNextButton || shouldShowFinishButton) && (
                <button
                  className={`btn ${shouldShowFinishButton ? "btn-success" : "btn-primary"
                    }`}
                  onClick={() => handleNavigation("next")}
                  disabled={!isNextButtonEnabled}
                >
                  {isLoading ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      />
                      {shouldShowFinishButton ? "Processing..." : "Loading..."}
                    </>
                  ) : shouldShowFinishButton ? (
                    "Finish Setup"
                  ) : (
                    "Next"
                  )}
                </button>
              )}
            </footer>
          )}
          {cloneDialog?.show && (
            <CloneDialogModal
              dialog={cloneDialog}
              isLoading={isLoading}
              onClone={handleSetupDirectory}
              onClose={() => setCloneDialog(null)}
            />
          )}
        </div>
      </div>
      
      {showConfigEditor && (
        <ConfigurationEditor
          userSelections={userSelections}
          parsedEnvEntries={parsedEnvEntries}
          electronAPI={electronAPI}
          onSave={handleSaveConfiguration}
          onCancel={() => setShowConfigEditor(false)}
        />
      )}
      
      {showSystemInfo && (
        <SystemInfoModal
          electronAPI={electronAPI}
          onClose={() => setShowSystemInfo(false)}
        />
      )}
      
      {showServiceManagement && (
        <ServiceManagementModal
          electronAPI={electronAPI}
          onClose={() => setShowServiceManagement(false)}
        />
      )}
      
      {showLogsViewer && (
        <LogsViewerModal
          electronAPI={electronAPI}
          onClose={() => setShowLogsViewer(false)}
        />
      )}
      <style jsx>{`
        .app-layout {
          display: flex;
          height: 100vh;
          overflow: hidden;
        }

        .main-content {
          flex: 1;
          overflow-y: auto;
          transition: margin-left 0.3s ease;
        }

        .main-content.with-sidebar {
          margin-left: ${isSetupComplete ? '320px' : '280px'};
        }

        .main-content.with-collapsed-sidebar {
          margin-left: 50px;
        }

        .installer-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          padding: 20px;
        }
      `}</style>
    </div>
  );
};

const App: React.FC = () => (
  <SiteNavigationProvider>
    <DockerProvider>
      <AppContent />
    </DockerProvider>
  </SiteNavigationProvider>
);

export default App;
