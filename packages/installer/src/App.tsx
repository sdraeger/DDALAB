import React, { useEffect } from "react";
import type { ParsedEnvEntry, ElectronAPI as UtilElectronAPI } from "./utils";

import WelcomeSite from "./components/WelcomeSite";
import DataLocationSite from "./components/DataLocationSite";
import ManualConfigSite from "./components/ManualConfigSite";
import SummarySite from "./components/SummarySite";
import ControlPanelSite from "./components/ControlPanelSite";
import { SiteNavigationProvider } from "./context/SiteNavigationProvider";
import { DockerProvider } from "./context/DockerProvider";
import { useSiteNavigation } from "./hooks/useSiteNavigation";
import { useNavigationValidation } from "./hooks/useNavigationValidation";

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

  const [isLoading, setIsLoading] = React.useState(false);
  const [showCloneDialog, setShowCloneDialog] = React.useState<{
    show: boolean;
    targetPath: string;
    message: string;
  } | null>(null);
  const electronAPI = window.electronAPI as UtilElectronAPI | undefined;

  const {
    isNextButtonEnabled,
    isBackButtonEnabled,
    shouldShowNextButton,
    shouldShowFinishButton,
    validationMessage,
  } = useNavigationValidation(
    currentSite,
    userSelections,
    parsedEnvEntries,
    isLoading
  );

  // Effect to load initial installer state and decide starting site
  useEffect(() => {
    console.log("[App.tsx] Initializing: Attempting to get installer state...");
    if (electronAPI && typeof electronAPI.getInstallerState === "function") {
      electronAPI
        .getInstallerState()
        .then((state) => {
          console.log("[App.tsx] Initial installer state received:", state);
          if (state.setupComplete) {
            console.log(
              "[App.tsx] Setup is complete. Navigating to control panel."
            );
            goToSite("control-panel");
            if (typeof state.setupPath === "string") {
              updateSelections({
                dataLocation: state.setupPath,
              });
            }
          } else {
            console.log(
              "[App.tsx] Setup is not complete. Navigating to welcome site."
            );
            goToSite("welcome");
          }
        })
        .catch((error) => {
          console.error(
            "[App.tsx] Error getting initial installer state:",
            error
          );
          goToSite("welcome");
        });
    } else {
      console.warn(
        "[App.tsx] electronAPI.getInstallerState is not available. Defaulting to welcome page."
      );
      goToSite("welcome");
    }
  }, [electronAPI]);

  const handleNext = async () => {
    if (isLoading) return; // Prevent double-clicking

    setIsLoading(true);
    let canProceed = true;

    try {
      switch (currentSite) {
        case "welcome":
          if (!userSelections.setupType) {
            alert("Please select a setup type.");
            canProceed = false;
          }
          if (userSelections.setupType === "automatic") {
            updateSelections({ envVariables: {} });
          }
          break;

        case "data-location":
          if (!userSelections.dataLocation) {
            alert("Please select a data location.");
            canProceed = false;
            break;
          }
          if (electronAPI && electronAPI.loadEnvVars) {
            try {
              console.log(
                "[App.tsx] Attempting to load ENV vars from data location:",
                userSelections.dataLocation
              );
              const entries = await electronAPI.loadEnvVars(
                userSelections.dataLocation
              );
              if (entries) {
                console.log(
                  "[App.tsx] Loaded ENV vars for auto setup:",
                  entries
                );
                const autoLoadedVars: { [key: string]: string } = {};
                entries.forEach(
                  (entry: ParsedEnvEntry) =>
                    (autoLoadedVars[entry.key] = entry.value)
                );
                updateSelections({ envVariables: autoLoadedVars });
              } else {
                console.log(
                  "[App.tsx] No ENV vars found at data location for auto setup."
                );
                updateSelections({ envVariables: {} });
              }
            } catch (err) {
              console.error(
                "[App.tsx] Error loading env vars for auto setup:",
                err
              );
              alert(
                "Could not load environment variables for automatic setup from the selected directory."
              );
              canProceed = false;
            }
          }
          break;

        case "manual-config":
          // Handle manual setup completion and validation
          if (!userSelections.dataLocation) {
            alert("Please select a directory first.");
            canProceed = false;
            break;
          }

          if (electronAPI) {
            try {
              console.log(
                "[App.tsx] Attempting to mark manual setup complete for:",
                userSelections.dataLocation
              );
              const result = await electronAPI.markSetupComplete(
                userSelections.dataLocation
              );

              if (result.success && result.finalSetupPath) {
                console.log(
                  "[App.tsx] Manual setup validation successful:",
                  result.finalSetupPath
                );
                // Update the data location to the final setup path
                updateSelections({ dataLocation: result.finalSetupPath });
              } else if (result.needsClone && result.targetPath) {
                // Need to clone - show dialog and stop navigation
                setShowCloneDialog({
                  show: true,
                  targetPath: result.targetPath,
                  message:
                    result.message ||
                    `No docker-compose.yml found in ${result.targetPath}. Would you like to clone the DDALAB repository into this directory?`,
                });
                canProceed = false;
              } else {
                alert(
                  result.message || "Failed to validate manual setup directory."
                );
                canProceed = false;
              }
            } catch (error) {
              console.error("[App.tsx] Error validating manual setup:", error);
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              alert(`Failed to validate manual setup: ${errorMessage}`);
              canProceed = false;
            }
          } else {
            alert("Setup validation not available.");
            canProceed = false;
          }
          break;

        case "summary":
          // Execute installation logic based on setup type
          if (electronAPI) {
            try {
              console.log("[App.tsx] Starting installation process...");

              if (userSelections.setupType === "automatic") {
                // For automatic setup, run the initial setup
                console.log("[App.tsx] Running automatic setup...");
                // Convert directory path to proper DDALAB_ALLOWED_DIRS format
                const allowedDirsValue = `${userSelections.dataLocation}:/app/data:rw`;
                await electronAPI.runInitialSetup(allowedDirsValue);
                console.log("[App.tsx] Automatic setup completed successfully");
              } else {
                // For manual setup, save env file and mark setup complete
                console.log("[App.tsx] Completing manual setup...");

                // Save environment variables using saveEnvFile
                if (userSelections.dataLocation) {
                  await electronAPI.saveEnvFile(
                    userSelections.dataLocation,
                    userSelections.envVariables
                  );
                  console.log("[App.tsx] Environment file saved");
                }

                // Mark setup as complete
                await electronAPI.markSetupComplete(
                  userSelections.dataLocation
                );
                console.log("[App.tsx] Manual setup marked as complete");
              }

              setInstallationSuccess(true);
              console.log(
                "[App.tsx] Installation process completed successfully"
              );
            } catch (error) {
              console.error("[App.tsx] Installation failed:", error);
              setInstallationSuccess(false);
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              alert(`Installation failed: ${errorMessage}`);
              canProceed = false;
            }
          } else {
            console.error(
              "[App.tsx] electronAPI not available for installation"
            );
            alert("Installation interface not available");
            canProceed = false;
          }
          break;
      }

      if (canProceed) {
        goToNextSite();
      }
    } catch (error) {
      console.error("[App.tsx] Error in handleNext:", error);
      alert("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    goToPreviousSite();
  };

  const handleCloneRepository = async () => {
    if (!showCloneDialog?.targetPath || !electronAPI) {
      return;
    }

    setIsLoading(true);

    try {
      // Convert directory path to proper DDALAB_ALLOWED_DIRS format
      const allowedDirsValue = `${showCloneDialog.targetPath}:/app/data:rw`;
      const result = await electronAPI.cloneRepositoryToDirectory(
        showCloneDialog.targetPath,
        allowedDirsValue
      );

      if (result.success && result.setupPath) {
        // Clone successful - update data location and close dialog
        updateSelections({ dataLocation: result.setupPath });
        setShowCloneDialog(null);

        // Load environment variables from the cloned repository
        try {
          const entries = await electronAPI.loadEnvVars(result.setupPath);
          if (entries) {
            console.log(
              "[App.tsx] Loaded ENV vars from cloned repository:",
              entries
            );
            const loadedVars: { [key: string]: string } = {};
            entries.forEach((entry: ParsedEnvEntry) => {
              loadedVars[entry.key] = entry.value;
            });
            updateSelections({
              envVariables: { ...userSelections.envVariables, ...loadedVars },
            });
            updateEnvEntries(entries);
          }
        } catch (envError) {
          console.warn(
            "[App.tsx] Could not load env vars from cloned repo:",
            envError
          );
        }

        // Now proceed to next site
        goToNextSite();
      } else {
        alert(result.message || "Failed to clone repository.");
      }
    } catch (error) {
      console.error("[App.tsx] Error cloning repository:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      alert(`Failed to clone repository: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelClone = () => {
    setShowCloneDialog(null);
  };

  const renderCurrentSite = () => {
    const commonProps = {
      userSelections,
      onUpdateSelections: updateSelections,
      parsedEnvEntries,
      onUpdateEnvEntries: updateEnvEntries,
      onNext: handleNext,
      onBack: handleBack,
      electronAPI,
    };

    switch (currentSite) {
      case "welcome":
        return (
          <WelcomeSite
            {...commonProps}
            onSetupTypeChange={(type) => updateSelections({ setupType: type })}
          />
        );
      case "data-location":
        return (
          <DataLocationSite
            {...commonProps}
            onDataLocationChange={(path) =>
              updateSelections({ dataLocation: path })
            }
          />
        );
      case "manual-config":
        return (
          <ManualConfigSite
            {...commonProps}
            onEnvVariableChange={(key, value) =>
              updateSelections({
                envVariables: { ...userSelections.envVariables, [key]: value },
              })
            }
            onUpdateSelections={updateSelections}
            setParsedEnvEntries={updateEnvEntries}
          />
        );
      case "summary":
        return <SummarySite {...commonProps} />;
      case "control-panel":
        return <ControlPanelSite {...commonProps} />;
      default:
        return <div>Loading...</div>;
    }
  };

  return (
    <div className="installer-container">
      {renderCurrentSite()}
      <footer
        id="navigation"
        className="mt-auto pt-3 border-top d-flex justify-content-between"
      >
        <button
          id="back-button"
          className="btn btn-secondary"
          onClick={handleBack}
          disabled={!isBackButtonEnabled}
        >
          Back
        </button>
        <div>
          {shouldShowNextButton && (
            <button
              id="next-button"
              className="btn btn-primary"
              onClick={handleNext}
              disabled={!isNextButtonEnabled}
            >
              {isLoading ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-hidden="true"
                  ></span>
                  Loading...
                </>
              ) : (
                "Next"
              )}
            </button>
          )}
          {shouldShowFinishButton && (
            <button
              id="finish-button"
              className="btn btn-success"
              onClick={handleNext}
              disabled={!isNextButtonEnabled}
            >
              {isLoading ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-hidden="true"
                  ></span>
                  Processing...
                </>
              ) : (
                "Finish"
              )}
            </button>
          )}
        </div>
      </footer>

      {/* Clone Repository Dialog */}
      {showCloneDialog?.show && (
        <div
          className="modal d-block"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancelClone();
          }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Clone DDALAB Repository?</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={handleCancelClone}
                  disabled={isLoading}
                ></button>
              </div>
              <div className="modal-body">
                <p>{showCloneDialog.message}</p>
                <p className="text-muted">
                  <small>
                    This will clone the DDALAB repository into:{" "}
                    <code>{showCloneDialog.targetPath}</code>
                  </small>
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCancelClone}
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCloneRepository}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
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
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <SiteNavigationProvider>
      <DockerProvider>
        <AppContent />
      </DockerProvider>
    </SiteNavigationProvider>
  );
};

export default App;
