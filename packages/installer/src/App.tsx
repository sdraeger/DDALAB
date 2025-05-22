import React, { useEffect } from "react";
import type {
  UserSelections,
  ParsedEnvEntry,
  ElectronAPI as UtilElectronAPI,
} from "./utils";

import WelcomeSite from "./components/WelcomeSite";
import DataLocationSite from "./components/DataLocationSite";
import ManualConfigSite from "./components/ManualConfigSite";
import SummarySite from "./components/SummarySite";
import ControlPanelSite from "./components/ControlPanelSite";
import { SiteNavigationProvider } from "./context/SiteNavigationProvider";
import { DockerProvider } from "./context/DockerProvider";
import { useSiteNavigation } from "./hooks/useSiteNavigation";
import { useNavigationValidation } from "./hooks/useNavigationValidation";

interface Site {
  id: string;
  title: string;
  component: React.FC<any>;
  condition?: (selections: UserSelections) => boolean;
  onNext?: (
    selections: UserSelections,
    setSelections: React.Dispatch<React.SetStateAction<UserSelections>>,
    electronAPI?: UtilElectronAPI,
    parsedEnvEntries?: ParsedEnvEntry[]
  ) => boolean | Promise<boolean>;
  onLoad?: (
    electronAPI: UtilElectronAPI | undefined,
    setParsedEnvEntries: React.Dispatch<React.SetStateAction<ParsedEnvEntry[]>>,
    setUserSelections: React.Dispatch<React.SetStateAction<UserSelections>>
  ) => Promise<void>;
}

// Helper to generate .env file content
const generateEnvFileContent = (
  envVariables: { [key: string]: string },
  parsedEntries?: ParsedEnvEntry[]
): string => {
  let content = "";
  const allKeys = new Set(Object.keys(envVariables));

  // If parsedEntries are available, use them for ordering and comments
  if (parsedEntries && parsedEntries.length > 0) {
    const entryMap = new Map(
      parsedEntries.map((e: ParsedEnvEntry) => [e.key, e])
    );
    parsedEntries.forEach((entry: ParsedEnvEntry) => {
      if (entry.comments && entry.comments.length > 0) {
        content += entry.comments.map((c) => `# ${c}`).join("\n") + "\n";
      }
      const value = envVariables[entry.key] || entry.value || "";
      const needsQuotes = /[\s#'"=]/.test(value) || value === "";
      const displayValue = needsQuotes
        ? `"${value.replace(/"/g, '\\"')}"`
        : value;
      content += `${entry.key}=${displayValue}\n\n`;
      allKeys.delete(entry.key);
    });
  }

  // Add any remaining keys that were not in parsedEntries
  allKeys.forEach((key) => {
    const value = envVariables[key] || "";
    const needsQuotes = /[\s#'"=]/.test(value) || value === "";
    const displayValue = needsQuotes
      ? `"${value.replace(/"/g, '\\"')}"`
      : value;
    content += `${key}=${displayValue}\n`;
  });
  return content.trim();
};

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

  const [isLoading, setIsLoading] = React.useState(false);
  const electronAPI = window.electronAPI as UtilElectronAPI | undefined;

  // Use the navigation validation hook
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
          // Manual config validation would go here
          break;

        case "summary":
          // Execute installation logic based on setup type
          if (electronAPI) {
            try {
              console.log("[App.tsx] Starting installation process...");

              if (userSelections.setupType === "automatic") {
                // For automatic setup, run the initial setup
                console.log("[App.tsx] Running automatic setup...");
                await electronAPI.runInitialSetup(userSelections.dataLocation);
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
