import React, { useEffect, useState } from "react";
import type { ParsedEnvEntry, ElectronAPI } from "./utils/electron";
import {
  WelcomeSite,
  DataLocationSite,
  CloneLocationSite,
  ManualConfigSite,
  SummarySite,
  ControlPanelSite,
} from "./components";
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
  userSelections: any;
  onUpdateSelections: (selections: any) => void;
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
    className="modal d-block"
    style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    onClick={(e) => e.target === e.currentTarget && onClose()}
  >
    <div className="modal-dialog modal-dialog-centered">
      <div className="modal-content">
        <div className="modal-header">
          <h5 className="modal-title">Clone DDALAB Repository?</h5>
          <button
            className="btn-close"
            onClick={onClose}
            disabled={isLoading}
          />
        </div>
        <div className="modal-body">
          <p>{dialog.message}</p>
          <p className="text-muted">
            <small>
              This will clone the DDALAB repository into:{" "}
              <code>{dialog.targetPath}</code>
            </small>
          </p>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
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
                Cloning...
              </>
            ) : (
              "Yes, Clone Repository"
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
    goToNextSite,
    goToPreviousSite,
    goToSite,
    updateSelections,
    updateEnvEntries,
    setInstallationSuccess,
  } = useSiteNavigation();

  const [isLoading, setIsLoading] = useState(false);
  const [cloneDialog, setCloneDialog] = useState<CloneDialog | null>(null);
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

  const validateManualSetup = async (path: string): Promise<boolean> => {
    if (!electronAPI || !path) {
      alert("Setup validation not available or no directory selected.");
      return false;
    }
    try {
      const result = await electronAPI.markSetupComplete(path);
      if (result.success && result.setupPath) {
        updateSelections({
          dataLocation: result.setupPath,
          cloneLocation: result.setupPath,
        });
        return true;
      }
      if (result.needsClone && result.targetPath) {
        setCloneDialog({
          show: true,
          targetPath: result.targetPath,
          message:
            result.message ||
            `No docker-compose.yml found in ${result.targetPath}. Would you like to clone the DDALAB repository?`,
        });
      } else {
        alert(result.message || "Failed to validate manual setup directory.");
      }
      return false;
    } catch (error) {
      alert(`Failed to validate manual setup: ${String(error)}`);
      return false;
    }
  };

  const executeInstallation = async (): Promise<boolean> => {
    if (!electronAPI || !userSelections.dataLocation) {
      alert("Installation interface not available or no directory selected.");
      return false;
    }
    try {
      if (userSelections.setupType === "automatic") {
        if (!userSelections.cloneLocation) {
          alert("Clone location not selected for automatic setup.");
          return false;
        }
        await electronAPI.runInitialSetup(
          userSelections.dataLocation,
          userSelections.cloneLocation
        );
      } else {
        await electronAPI.saveEnvFile(
          userSelections.dataLocation,
          userSelections.envVariables
        );
        await electronAPI.markSetupComplete(userSelections.dataLocation);
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
          } else if (userSelections.setupType === "automatic") {
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
            alert("Please select a clone location.");
            canProceed = false;
          }
          break;
        case "manual-config":
          canProceed = await validateManualSetup(userSelections.dataLocation);
          break;
        case "summary":
          canProceed = await executeInstallation();
          break;
      }
      if (canProceed) goToNextSite();
    } catch (error) {
      alert("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloneRepository = async () => {
    if (!cloneDialog?.targetPath || !electronAPI) return;
    setIsLoading(true);
    try {
      const allowedDirsValue = `${cloneDialog.targetPath}:/app/data:rw`;
      const result = await electronAPI.cloneRepositoryToDirectory(
        cloneDialog.targetPath,
        allowedDirsValue
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
        alert(result.message || "Failed to clone repository.");
      }
    } catch (error) {
      alert(`Failed to clone repository: ${String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const initializeApp = async () => {
      if (!electronAPI?.getInstallerState) {
        goToSite("welcome");
        return;
      }
      try {
        const state = await electronAPI.getInstallerState();
        if (state.setupComplete) {
          goToSite("control-panel");
          updateSelections({
            dataLocation: state.dataLocation || state.setupPath,
            cloneLocation: state.cloneLocation || state.setupPath,
          });
        } else {
          goToSite("welcome");
        }
      } catch (error) {
        goToSite("welcome");
      }
    };
    initializeApp();
  }, []);

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
    <div className="installer-container">
      {siteComponents[currentSite] || <div>Loading...</div>}
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
            className={`btn ${
              shouldShowFinishButton ? "btn-success" : "btn-primary"
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
              "Finish"
            ) : (
              "Next"
            )}
          </button>
        )}
      </footer>
      {cloneDialog?.show && (
        <CloneDialogModal
          dialog={cloneDialog}
          isLoading={isLoading}
          onClone={handleCloneRepository}
          onClose={() => setCloneDialog(null)}
        />
      )}
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
