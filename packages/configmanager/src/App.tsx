import React, { useEffect, useState } from "react";
import type {
  ParsedEnvEntry,
  ElectronAPI,
  UserSelections,
} from "./utils/electron";
import type { DockerStatus } from "../preload";
import { logger } from "./utils/logger-client";
import {
  WelcomeSite,
  DataLocationSite,
  ProjectLocationSite,
  ManualConfigSite,
  DockerConfigSite,
  SummarySite,
  ConfigurationEditor,
  SystemInfoModal,
  BugReportModal,
  EnhancedControlPanel,
  UpdateProgressModal,
  QuitConfirmationModal,
  MenuActionHandler,
  AppLayout,
  NavigationErrorBoundary,
  SectionErrorBoundary,
  ModalErrorBoundary,
  HealthStatusModal,
} from "./components";
import MissingInstallationAlert from "./components/MissingInstallationAlert";
import { SiteNavigationProvider } from "./context/SiteNavigationProvider";
import { DockerProvider } from "./context/DockerProvider";
import { SystemStatusProvider } from "./context/SystemStatusProvider";
import { HealthStatusProvider } from "./context/HealthStatusProvider";
import { useSiteNavigation } from "./hooks/useSiteNavigation";
import { useNavigationValidation } from "./hooks/useNavigationValidation";
import { useAppNavigation } from "./hooks/useAppNavigation";
import { useEnvironmentLoader } from "./hooks/useEnvironmentLoader";
import { useStatePersistence } from "./hooks/useStatePersistence";

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
  <div
    className="modal fade show d-block"
    style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
  >
    <div className="modal-dialog">
      <div className="modal-content">
        <div className="modal-header">
          <h5 className="modal-title">Setup Directory</h5>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
          ></button>
        </div>
        <div className="modal-body">
          <p>{dialog.message}</p>
          <p>
            <strong>Target Path:</strong> {dialog.targetPath}
          </p>
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
  const electronAPI = window.electronAPI as ElectronAPI | undefined;
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
  const [showBugReport, setShowBugReport] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showQuitConfirmation, setShowQuitConfirmation] = useState(false);
  const [showHealthStatus, setShowHealthStatus] = useState(false);
  const [isDDALABRunning, setIsDDALABRunning] = useState(false);

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

  const { handleNavigation, validateDockerSetup, executeDockerInstallation } =
    useAppNavigation(electronAPI, setIsSetupComplete);

  const { loadEnvVars } = useEnvironmentLoader(
    electronAPI,
    updateSelections,
    updateEnvEntries
  );

  useStatePersistence(
    electronAPI,
    userSelections,
    currentSite,
    parsedEnvEntries,
    installationSuccess
  );

  const handleValidateDockerSetup = async (path: string): Promise<boolean> => {
    const result = await validateDockerSetup(path);
    if (!result && electronAPI) {
      const validationResult = await electronAPI.validateDockerSetup(path);
      if (validationResult.needsSetup && validationResult.targetPath) {
        setCloneDialog({
          show: true,
          targetPath: validationResult.targetPath,
          message:
            validationResult.message ||
            `No DDALAB Docker setup found in ${validationResult.targetPath}. Would you like to create the necessary files?`,
        });
      }
    }
    return result;
  };

  const handleNavigationWrapper = async (direction: "next" | "back") => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await handleNavigation(direction);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetupDirectory = async () => {
    if (!cloneDialog?.targetPath || !electronAPI) return;
    setIsLoading(true);
    try {
      // Build the user configuration with defaults
      const userConfig = {
        dataLocation: cloneDialog.targetPath,
        allowedDirs: userSelections.envVariables?.DDALAB_ALLOWED_DIRS || `${cloneDialog.targetPath}:/app/data:rw`,
        webPort: userSelections.envVariables?.WEB_PORT || '3000',
        apiPort: userSelections.envVariables?.DDALAB_API_PORT || '8001',
        apiPortMetrics: userSelections.envVariables?.API_PORT_METRICS || '8002',
        dbPassword: userSelections.envVariables?.DDALAB_DB_PASSWORD || 'ddalab_password',
        minioPassword: userSelections.envVariables?.MINIO_ROOT_PASSWORD || 'ddalab_password',
        traefikEmail: userSelections.envVariables?.TRAEFIK_ACME_EMAIL || 'admin@ddalab.local',
        useDockerHub: true,
        authMode: userSelections.envVariables?.DDALAB_AUTH_MODE || 'local',
        projectLocation: cloneDialog.targetPath,
      };
      
      const result = await electronAPI.setupDockerDirectory(
        cloneDialog.targetPath,
        userConfig
      );
      if (result.success) {
        updateSelections({
          dataLocation: cloneDialog.targetPath,
          projectLocation: cloneDialog.targetPath,
        });
        await loadEnvVars(cloneDialog.targetPath);
        setCloneDialog(null);
        goToNextSite();
      } else {
        logger.error(
          "Failed to setup directory",
          result.message || "Failed to setup directory"
        );
      }
    } catch (error) {
      logger.error("Failed to setup directory", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const initializeApp = async () => {
      if (!electronAPI?.getConfigManagerState) {
        goToSite("welcome");
        return;
      }
      try {
        const state = await electronAPI.getConfigManagerState();

        if (state.userSelections) {
          updateSelections(state.userSelections);
        }

        if (state.currentSite) {
          goToSite(state.currentSite);
        }

        if (state.parsedEnvEntries) {
          updateEnvEntries(state.parsedEnvEntries);
        }

        if (state.installationSuccess !== undefined) {
          setInstallationSuccess(state.installationSuccess || false);
        }

        if (state.setupComplete) {
          setIsSetupComplete(true);
          goToSite("control-panel");
          updateSelections({
            dataLocation: state.dataLocation || state.setupPath || "",
            projectLocation: state.projectLocation || state.setupPath || "",
          });
        } else {
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

  useEffect(() => {
    if (!electronAPI) return;

    const removeQuitListener = electronAPI.onQuitRequest
      ? electronAPI.onQuitRequest(() => {
          if (electronAPI.getDockerStatus) {
            electronAPI
              .getDockerStatus()
              .then((status: DockerStatus) => {
                setIsDDALABRunning(status.isRunning);
                setShowQuitConfirmation(true);
              })
              .catch(() => {
                setIsDDALABRunning(false);
                setShowQuitConfirmation(true);
              });
          } else {
            setIsDDALABRunning(false);
            setShowQuitConfirmation(true);
          }
        })
      : null;

    const removeDockerListener = electronAPI.onDockerStatusUpdate
      ? electronAPI.onDockerStatusUpdate(
          (statusUpdate: { type: string; message: string }) => {
            if (statusUpdate.type === "docker-running") {
              setIsDDALABRunning(true);
            } else if (statusUpdate.type === "docker-stopped") {
              setIsDDALABRunning(false);
            }
          }
        )
      : null;

    return () => {
      if (removeQuitListener) removeQuitListener();
      if (removeDockerListener) removeDockerListener();
    };
  }, [electronAPI]);

  const handleEditConfig = () => {
    setShowConfigEditor(true);
  };

  const handleSystemInfo = () => {
    setShowSystemInfo(true);
  };

  const handleBugReport = () => {
    setShowBugReport(true);
  };

  const handleNewSetup = () => {
    goToSite("welcome");
    updateSelections({});
    updateEnvEntries([]);
    setInstallationSuccess(false);
    setIsSetupComplete(false);
  };

  const handleStartNewSetupFromAlert = () => {
    logger.info("Starting new setup from missing installation alert");
    handleNewSetup();
  };

  const handleShowHealthFromAlert = () => {
    setShowHealthStatus(true);
  };

  const handleShowUpdateModal = () => {
    setShowUpdateModal(true);
  };

  const handleConfirmQuit = async (stopDDALAB: boolean) => {
    if (!electronAPI) return;

    try {
      if (stopDDALAB && isDDALABRunning) {
        await electronAPI.stopMonolithicDocker(false);
      }

      setShowQuitConfirmation(false);

      if (electronAPI.confirmQuit) {
        electronAPI.confirmQuit();
      }
    } catch (error) {
      logger.error("Error during quit process", error);
      setShowQuitConfirmation(false);
      if (electronAPI.confirmQuit) {
        electronAPI.confirmQuit();
      }
    }
  };

  const handleSaveConfiguration = async (
    selections: Partial<UserSelections>,
    envEntries: ParsedEnvEntry[]
  ) => {
    try {
      updateSelections(selections);
      updateEnvEntries(envEntries);

      if (electronAPI?.saveUserState) {
        await electronAPI.saveUserState(
          { ...userSelections, ...selections },
          currentSite,
          envEntries,
          installationSuccess
        );
      }

      if (electronAPI?.saveEnvFile && userSelections.dataLocation) {
        await electronAPI.saveEnvFile(
          userSelections.dataLocation,
          selections.envVariables || userSelections.envVariables
        );
      }

      setShowConfigEditor(false);
      logger.info("Configuration saved successfully");
    } catch (error) {
      logger.error("Failed to save configuration", error);
    }
  };

  const commonProps: CommonProps = {
    userSelections,
    onUpdateSelections: updateSelections,
    parsedEnvEntries,
    onUpdateEnvEntries: updateEnvEntries,
    onNext: () => handleNavigationWrapper("next"),
    onBack: () => handleNavigationWrapper("back"),
    electronAPI: electronAPI,
  };

  const siteComponents: Record<string, JSX.Element> = {
    welcome: (
      <SectionErrorBoundary sectionName="Welcome">
        <WelcomeSite
          {...commonProps}
          onSetupTypeChange={(type) => updateSelections({ setupType: type })}
        />
      </SectionErrorBoundary>
    ),
    "data-location": (
      <SectionErrorBoundary sectionName="Data Location">
        <DataLocationSite
          {...commonProps}
          onDataLocationChange={(path) =>
            updateSelections({ dataLocation: path })
          }
          onEnvVariableChange={(key, value) =>
            updateSelections({
              envVariables: { ...userSelections.envVariables, [key]: value },
            })
          }
        />
      </SectionErrorBoundary>
    ),
    "clone-location": (
      <SectionErrorBoundary sectionName="Project Location">
        <ProjectLocationSite
          {...commonProps}
          onProjectLocationChange={(path) =>
            updateSelections({ projectLocation: path })
          }
        />
      </SectionErrorBoundary>
    ),
    "docker-config": (
      <SectionErrorBoundary sectionName="Docker Configuration">
        <DockerConfigSite {...commonProps} />
      </SectionErrorBoundary>
    ),
    "manual-config": (
      <SectionErrorBoundary sectionName="Manual Configuration">
        <ManualConfigSite
          {...commonProps}
          onEnvVariableChange={(key, value) =>
            updateSelections({
              envVariables: { ...userSelections.envVariables, [key]: value },
            })
          }
          setParsedEnvEntries={updateEnvEntries}
        />
      </SectionErrorBoundary>
    ),
    summary: (
      <SectionErrorBoundary sectionName="Summary">
        <SummarySite {...commonProps} />
      </SectionErrorBoundary>
    ),
    "control-panel": (
      <SectionErrorBoundary sectionName="Control Panel">
        <EnhancedControlPanel
          electronAPI={electronAPI}
          userSelections={userSelections}
          onEditConfig={handleEditConfig}
          onSystemInfo={handleSystemInfo}
          onBugReport={handleBugReport}
        />
      </SectionErrorBoundary>
    ),
  };

  return (
    <HealthStatusProvider
      electronAPI={electronAPI}
      userSelections={userSelections}
      isSetupComplete={isSetupComplete}
      autoStart={true}
      intervalMs={60000}
    >
      <MenuActionHandler
        electronAPI={electronAPI}
        userSelections={userSelections}
        goToSite={goToSite}
        updateSelections={updateSelections}
        updateEnvEntries={updateEnvEntries}
        setInstallationSuccess={setInstallationSuccess}
        validateDockerSetup={handleValidateDockerSetup}
      />
      <AppLayout
        isSetupComplete={isSetupComplete}
        sidebarExpanded={sidebarExpanded}
        onToggleSidebar={() => setSidebarExpanded(!sidebarExpanded)}
        currentSite={currentSite}
        setupType={userSelections.setupType}
        electronAPI={electronAPI}
        userSelections={userSelections}
        onNewSetup={handleNewSetup}
        onShowUpdateModal={handleShowUpdateModal}
        onShowHealthDetails={() => setShowHealthStatus(true)}
      >
        <NavigationErrorBoundary
          currentSite={currentSite}
          onNavigateHome={() => goToSite("welcome")}
        >
          {siteComponents[currentSite] || <div>Loading...</div>}
        </NavigationErrorBoundary>
        {!isSetupComplete && (
          <footer className="mt-auto pt-3 border-top d-flex justify-content-between">
            <button
              className="btn btn-secondary"
              onClick={() => handleNavigationWrapper("back")}
              disabled={!isBackButtonEnabled}
            >
              Back
            </button>
            {(shouldShowNextButton || shouldShowFinishButton) && (
              <button
                className={`btn ${
                  shouldShowFinishButton ? "btn-success" : "btn-primary"
                }`}
                onClick={() => handleNavigationWrapper("next")}
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
      </AppLayout>

      {showConfigEditor && (
        <ModalErrorBoundary
          modalName="Configuration Editor"
          onClose={() => setShowConfigEditor(false)}
        >
          <ConfigurationEditor
            userSelections={userSelections}
            parsedEnvEntries={parsedEnvEntries}
            electronAPI={electronAPI}
            onSave={handleSaveConfiguration}
            onCancel={() => setShowConfigEditor(false)}
          />
        </ModalErrorBoundary>
      )}

      {showSystemInfo && (
        <ModalErrorBoundary
          modalName="System Information"
          onClose={() => setShowSystemInfo(false)}
        >
          <SystemInfoModal
            electronAPI={electronAPI}
            onClose={() => setShowSystemInfo(false)}
          />
        </ModalErrorBoundary>
      )}

      {showBugReport && (
        <ModalErrorBoundary
          modalName="Bug Report"
          onClose={() => setShowBugReport(false)}
        >
          <BugReportModal onClose={() => setShowBugReport(false)} />
        </ModalErrorBoundary>
      )}

      {showUpdateModal && (
        <ModalErrorBoundary
          modalName="Update Progress"
          onClose={() => setShowUpdateModal(false)}
        >
          <UpdateProgressModal
            electronAPI={electronAPI}
            onClose={() => setShowUpdateModal(false)}
          />
        </ModalErrorBoundary>
      )}
      {showQuitConfirmation && (
        <ModalErrorBoundary
          modalName="Quit Confirmation"
          onClose={() => setShowQuitConfirmation(false)}
        >
          <QuitConfirmationModal
            onClose={() => setShowQuitConfirmation(false)}
            onConfirmQuit={handleConfirmQuit}
            isDDALABRunning={isDDALABRunning}
          />
        </ModalErrorBoundary>
      )}

      {showHealthStatus && (
        <HealthStatusModal onClose={() => setShowHealthStatus(false)} />
      )}

      <MissingInstallationAlert
        onStartNewSetup={handleStartNewSetupFromAlert}
        onShowHealthDetails={handleShowHealthFromAlert}
      />

    </HealthStatusProvider>
  );
};

const App: React.FC = () => {
  const electronAPI = window.electronAPI as ElectronAPI | undefined;

  return (
    <SiteNavigationProvider>
      <DockerProvider>
        <SystemStatusProvider electronAPI={electronAPI}>
          <AppContent />
        </SystemStatusProvider>
      </DockerProvider>
    </SiteNavigationProvider>
  );
};

export default App;
