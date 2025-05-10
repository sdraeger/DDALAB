import React, { useState, useEffect, useCallback } from "react";
import type {
  UserSelections,
  ParsedEnvEntry,
  ElectronAPI as UtilElectronAPI,
} from "./utils";

import WelcomeSite from "./components/WelcomeSite";
import DataLocationSite from "./components/DataLocationSite";
import ManualConfigSite from "./components/ManualConfigSite";
import SummarySite from "./components/SummarySite";
import InstallProgressSite from "./components/InstallProgressSite";

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

  // Add any remaining keys that were not in parsedEntries (e.g., added manually)
  allKeys.forEach((key) => {
    const value = envVariables[key] || "";
    const needsQuotes = /[\s#'"=]/.test(value) || value === "";
    const displayValue = needsQuotes
      ? `"${value.replace(/"/g, '\\"')}"`
      : value;
    content += `${key}=${displayValue}\n`;
  });
  return content.trim(); // Trim trailing newlines
};

const App: React.FC = () => {
  const [currentSiteId, setCurrentSiteId] = useState<string>("welcome");
  const [userSelections, setUserSelections] = useState<UserSelections>({
    setupType: "automatic",
    dataLocation: "",
    envVariables: {},
    installationLog: [],
  });
  const [parsedEnvEntries, setParsedEnvEntries] = useState<ParsedEnvEntry[]>(
    []
  );
  const [installationSuccess, setInstallationSuccess] = useState<
    boolean | null
  >(null);

  const electronAPI = window.electronAPI as UtilElectronAPI | undefined;

  const sites: Site[] = [
    {
      id: "welcome",
      title: "Welcome",
      component: WelcomeSite,
      onNext: (selections) => {
        if (!selections.setupType) {
          alert("Please select a setup type.");
          return false;
        }
        // Reset dependent selections if setupType changes
        if (selections.setupType === "automatic") {
          setUserSelections((prev) => ({ ...prev, envVariables: {} })); // Clear manual vars
        }
        return true;
      },
    },
    {
      id: "data-location",
      title: "Data Location",
      component: DataLocationSite,
      condition: (selections) => selections.setupType === "automatic",
      onNext: async (selections, setSelections, api) => {
        if (!selections.dataLocation) {
          alert("Please select a data location.");
          return false;
        }
        if (api && api.loadEnvVars) {
          try {
            // Load from selected dataLocation
            console.log(
              "[App.tsx] Attempting to load ENV vars from data location:",
              selections.dataLocation
            );
            const entries = await api.loadEnvVars(selections.dataLocation);
            if (entries) {
              console.log("[App.tsx] Loaded ENV vars for auto setup:", entries);
              const autoLoadedVars: { [key: string]: string } = {};
              entries.forEach(
                (entry: ParsedEnvEntry) =>
                  (autoLoadedVars[entry.key] = entry.value)
              );
              setSelections((prev) => ({
                ...prev,
                envVariables: autoLoadedVars,
              }));
            } else {
              console.log(
                "[App.tsx] No ENV vars found at data location for auto setup."
              );
              // Keep existing envVariables or clear them? For now, let's clear to reflect "nothing loaded from this specific dir"
              setSelections((prev) => ({
                ...prev,
                envVariables: {},
              }));
            }
          } catch (err) {
            console.error(
              "[App.tsx] Error loading env vars for auto setup:",
              err
            );
            alert(
              "Could not load environment variables for automatic setup from the selected directory."
            );
            return false;
          }
        }
        return true;
      },
    },
    {
      id: "manual-config",
      title: "Manual Configuration",
      component: ManualConfigSite,
      condition: (selections) => selections.setupType === "manual",
      onLoad: async (api, setParsedEnvEntries, setSelectionsInternal) => {
        if (api && api.loadEnvVars) {
          try {
            console.log(
              "[App.tsx] Attempting to load initial ENV vars for manual setup (bundled example)."
            );
            const entries = await api.loadEnvVars(); // No dataDir, loads bundled/default
            if (entries) {
              console.log(
                "[App.tsx] Loaded initial ENV for manual setup:",
                entries
              );
              setParsedEnvEntries(entries);

              // Only pre-fill if envVariables is currently empty, to avoid overwriting user's progress
              // This logic might be better inside ManualConfigSite itself upon its mount
              // For now, if userSelections.envVariables is empty, populate it.
              setUserSelections((prev) => {
                if (Object.keys(prev.envVariables).length === 0) {
                  const initialVars: { [key: string]: string } = {};
                  entries.forEach(
                    (entry: ParsedEnvEntry) =>
                      (initialVars[entry.key] = entry.value)
                  );
                  return { ...prev, envVariables: initialVars };
                }
                return prev;
              });
            } else {
              console.log(
                "[App.tsx] No initial ENV (bundled) found for manual setup."
              );
            }
          } catch (err) {
            console.error(
              "[App.tsx] Error pre-loading env vars for manual setup:",
              err
            );
          }
        }
      },
    },
    {
      id: "summary",
      title: "Summary",
      component: SummarySite,
    },
    {
      id: "install-progress",
      title: "Installation",
      component: InstallProgressSite,
    },
  ];

  const activeSites = sites.filter(
    (site) => !site.condition || site.condition(userSelections)
  );
  const currentSiteIndex = activeSites.findIndex(
    (site) => site.id === currentSiteId
  );
  const CurrentSiteComponent = activeSites[currentSiteIndex]?.component;

  useEffect(() => {
    const siteDef = activeSites[currentSiteIndex];
    if (siteDef && siteDef.title) {
      document.title = `DDALAB Setup - ${siteDef.title}`;
    }
    if (siteDef && siteDef.onLoad) {
      siteDef.onLoad(electronAPI, setParsedEnvEntries, setUserSelections);
    }
  }, [
    currentSiteId,
    activeSites,
    currentSiteIndex,
    electronAPI,
    setParsedEnvEntries,
    setUserSelections,
  ]);

  const handleNext = async () => {
    const siteDef = activeSites[currentSiteIndex];
    let canProceed = true;

    // If on summary page, and about to proceed (to install-progress)
    if (siteDef?.id === "summary") {
      if (electronAPI && electronAPI.saveEnvConfig) {
        try {
          const envContent = generateEnvFileContent(
            userSelections.envVariables,
            parsedEnvEntries
          );
          let targetSaveDir: string | null = null;
          if (userSelections.dataLocation) {
            targetSaveDir = userSelections.dataLocation;
          } else if (userSelections.setupType === "manual") {
            targetSaveDir = "PROJECT_ROOT";
          }

          if (
            targetSaveDir === null &&
            userSelections.setupType !== "manual" &&
            userSelections.setupType !== "automatic"
          ) {
            // If automatic, dataLocation should always be set.
            // If manual and no dataLocation, it's PROJECT_ROOT.
            // This condition means setupType is something else or dataLocation is missing when it shouldn't be.
            // For automatic, dataLocation is mandatory by this point (checked in its own onNext).
            alert(
              "Error: Critical configuration missing. Cannot determine where to save the .env file."
            );
            return;
          }

          // For automatic, targetSaveDir will be dataLocation. For manual, it's dataLocation or PROJECT_ROOT.
          // The null case for targetSaveDir is effectively handled by the 'PROJECT_ROOT' signal for manual.
          const effectiveTarget =
            userSelections.dataLocation ||
            (userSelections.setupType === "manual" ? "PROJECT_ROOT" : null);
          if (!effectiveTarget) {
            alert("Error: Cannot determine a save location for .env file.");
            return;
          }

          console.log(
            `[App.tsx] Saving .env config to target: ${effectiveTarget} with content:\n${envContent}`
          );
          await electronAPI.saveEnvConfig(effectiveTarget, envContent);
          console.log("[App.tsx] .env configuration saved.");
        } catch (err: any) {
          // Explicitly type err
          console.error("[App.tsx] Error saving .env configuration:", err);
          alert(`Failed to save .env configuration: ${err.message}`);
          // canProceed = false; // Decide if save failure should block installation
        }
      }
    }

    if (siteDef?.onNext) {
      canProceed =
        canProceed &&
        (await siteDef.onNext(
          userSelections,
          setUserSelections,
          electronAPI,
          parsedEnvEntries
        ));
    }

    if (canProceed) {
      if (currentSiteIndex < activeSites.length - 1) {
        setCurrentSiteId(activeSites[currentSiteIndex + 1].id);
      } else {
        // Last step is install-progress, or summary if install is skipped/failed
        // If current is summary, next should be install-progress.
        // If current is install-progress, its internal logic handles the finish button.
      }
    }
  };

  const handleBack = () => {
    if (currentSiteIndex > 0) {
      setCurrentSiteId(activeSites[currentSiteIndex - 1].id);
    }
  };

  const handleFinish = () => {
    // This function might be called by InstallProgressSite or if summary is final
    alert("Setup process is complete!");
    const finishButton = document.getElementById(
      "finish-button"
    ) as HTMLButtonElement;
    const nextButton = document.getElementById(
      "next-button"
    ) as HTMLButtonElement;
    const backButton = document.getElementById(
      "back-button"
    ) as HTMLButtonElement;
    if (finishButton) finishButton.textContent = "Close";
    if (nextButton) nextButton.style.display = "none";
    if (backButton) backButton.style.display = "none";
    // Consider closing the window or displaying a final message through electronAPI
    // window.close(); // Be careful with this, ensure it's the desired behavior
  };

  const updateNavigationButtons = useCallback(() => {
    const backBtn = document.getElementById("back-button") as HTMLButtonElement;
    const nextBtn = document.getElementById("next-button") as HTMLButtonElement;
    const finishBtn = document.getElementById(
      "finish-button"
    ) as HTMLButtonElement;

    if (!backBtn || !nextBtn || !finishBtn) return;

    const isInstallSite = currentSiteId === "install-progress";
    const isSummarySite = activeSites[currentSiteIndex]?.id === "summary";

    // Default states
    backBtn.style.display = "inline-block";
    nextBtn.style.display = "inline-block";
    finishBtn.style.display = "none";
    backBtn.disabled = currentSiteIndex === 0;
    nextBtn.disabled = false;
    finishBtn.disabled = false;

    backBtn.onclick = handleBack;
    nextBtn.onclick = handleNext;
    finishBtn.onclick = handleNext; // Default finish action is to proceed (like next)

    if (isInstallSite) {
      backBtn.style.display = "none"; // Hide Back button
      nextBtn.style.display = "none"; // Hide Next button
      finishBtn.style.display = "none"; // Hide Finish/Close button
    } else if (installationSuccess !== null) {
      // This case handles the state *after* an installation attempt if not on install-progress site
      // (e.g., if flow allowed going back and then an install happened, which is unlikely with current nav)
      // Given the new persistent nature of install-progress, this block might be less relevant
      // or could be removed if install-progress is truly the final interactive step.
      // For now, if we land here, it means install happened & we are not on install-progress, show a close.
      backBtn.style.display = "none";
      nextBtn.style.display = "none";
      finishBtn.style.display = "inline-block";
      finishBtn.textContent = "Close App";
      finishBtn.onclick = () => electronAPI?.quitApp(); // Use quitApp from electronAPI
    } else {
      // Regular site navigation (Welcome, Data Location, Manual Config, Summary)
      if (currentSiteIndex === 0) {
        // Welcome site or first active site
        backBtn.style.display = "none";
      }

      if (isSummarySite) {
        // On Summary, Next becomes Finish (triggering save & move to install-progress)
        nextBtn.style.display = "none";
        finishBtn.style.display = "inline-block";
        finishBtn.textContent = "Configure & Proceed";
        finishBtn.onclick = handleNext; // handleNext on summary page triggers save and moves to install-progress
      } else {
        nextBtn.style.display = "inline-block";
        finishBtn.style.display = "none";
      }

      // Disable Next on Welcome if no setupType selected
      if (currentSiteId === "welcome" && !userSelections.setupType) {
        nextBtn.disabled = true;
        // If summary is the only other step (e.g. manual -> summary)
        if (isSummarySite) finishBtn.disabled = true;
      }
    }
  }, [
    currentSiteIndex,
    currentSiteId,
    userSelections.setupType,
    activeSites,
    installationSuccess,
    handleBack,
    handleNext,
    electronAPI, // Added electronAPI for quitApp
  ]);

  useEffect(() => {
    updateNavigationButtons();
  }, [updateNavigationButtons]);

  if (!CurrentSiteComponent) {
    return <div>Loading site or site not found...</div>;
  }

  // Props for the current site component
  const componentProps = {
    userSelections,
    electronAPI,
    // WelcomeSite
    onSetupTypeChange: (setupType: "automatic" | "manual") =>
      setUserSelections((prev) => ({
        ...prev,
        setupType,
        envVariables: {},
        dataLocation: prev.setupType === setupType ? prev.dataLocation : "",
      })),
    // DataLocationSite
    onDataLocationChange: (path: string) =>
      setUserSelections((prev) => ({ ...prev, dataLocation: path })),
    // ManualConfigSite
    parsedEnvEntries,
    setParsedEnvEntries,
    onEnvVariableChange: (key: string, value: string) =>
      setUserSelections((prev) => ({
        ...prev,
        envVariables: { ...prev.envVariables, [key]: value },
      })),
    // SummarySite (no callbacks, just data)
    // InstallProgressSite
    onInstallComplete: (success: boolean) => {
      setInstallationSuccess(success);
      updateNavigationButtons(); // Explicitly update nav after install
      if (success) {
        // Optionally trigger a final action if all went well
      } else {
        // Offer retry or guide user
      }
    },
  };

  return <CurrentSiteComponent {...componentProps} />;
};

export default App;
