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
import ControlPanelSite from "./components/ControlPanelSite";

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
  const [currentSiteId, setCurrentSiteId] = useState<string>("loading"); // Start with a loading state
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
            setCurrentSiteId("control-panel");
            // Only update dataLocation if setupPath is a valid string
            if (typeof state.setupPath === "string") {
              setUserSelections((prev) => ({
                ...prev,
                dataLocation:
                  state.setupPath! /* Non-null asserted as we checked type */,
              }));
            }
          } else {
            console.log(
              "[App.tsx] Setup is not complete. Navigating to welcome site."
            );
            setCurrentSiteId("welcome");
          }
        })
        .catch((error) => {
          console.error(
            "[App.tsx] Error getting initial installer state:",
            error
          );
          setCurrentSiteId("welcome"); // Default to welcome on error
        });
    } else {
      console.warn(
        "[App.tsx] electronAPI.getInstallerState is not available. Defaulting to welcome page."
      );
      setCurrentSiteId("welcome"); // Fallback if API is not ready
    }
  }, [electronAPI]); // Dependency array ensures this runs when electronAPI is available

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
        // Check if parsedEnvEntries is already populated to prevent loop
        // This check needs to access the state value, not the setter.
        // This means `onLoad` needs access to the current `parsedEnvEntries` state.
        // For simplicity, we'll rely on the component `ManualConfigSite` to fetch
        // its initial data if needed, or App.tsx can pass parsedEnvEntries to it.
        // Let's adjust the logic here to be more idempotent or shift it.

        // To make `onLoad` safer, we can check a flag or if `parsedEnvEntries` (the state value) is empty.
        // However, `onLoad` doesn't have direct access to `parsedEnvEntries` state here.
        // A common pattern is to fetch data within the component itself (`ManualConfigSite`) using a useEffect hook.

        // For now, let's make this specific `onLoad` only run if `userSelections.envVariables` is empty,
        // implying it's the very first load of this manual config path for the session.
        // This is an approximation to break the loop. A more robust solution involves how
        // ManualConfigSite handles its own data needs.

        // The core issue is that `setUserSelections` or `setParsedEnvEntries` might be causing
        // the main `useEffect` (which calls `onLoad`) to run again if `activeSites` recomputes.

        // Let's try to ensure this only runs once effectively per visit to manual config without prior data.
        if (
          Object.keys(userSelections.envVariables).length > 0 &&
          parsedEnvEntries.length > 0
        ) {
          console.log(
            "[App.tsx] Manual config onLoad: envVariables or parsedEnvEntries already populated. Skipping initial load."
          );
          return;
        }

        if (api && api.loadEnvVars) {
          try {
            console.log(
              "[App.tsx] onLoad for manual-config: Attempting to load initial ENV vars (bundled example)."
            );
            // Only load if parsedEnvEntries is genuinely empty from the App's state perspective
            // This requires passing parsedEnvEntries state to onLoad or checking it before calling onLoad.
            // The current signature doesn't pass the state value, only the setter.
            // Let's refine this to be called more carefully from the main useEffect.

            // The log spam suggests api.loadEnvVars() itself is being called repeatedly.
            // This means the `onLoad` function is being called repeatedly.
            // The guard condition `Object.keys(userSelections.envVariables).length > 0 && parsedEnvEntries.length > 0`
            // added above uses the `userSelections` from App's scope and `parsedEnvEntries` from App's scope,
            // which is what we need.

            const entries = await api.loadEnvVars(); // No dataDir, loads bundled/default
            if (entries) {
              console.log(
                "[App.tsx] onLoad for manual-config: Loaded initial ENV:",
                entries
              );
              setParsedEnvEntries(entries); // This updates state from App.tsx

              // Only pre-fill if envVariables is currently empty
              setSelectionsInternal((prev) => {
                // This is setUserSelections from App.tsx
                if (Object.keys(prev.envVariables).length === 0) {
                  console.log(
                    "[App.tsx] onLoad for manual-config: Populating envVariables from loaded entries."
                  );
                  const initialVars: { [key: string]: string } = {};
                  entries.forEach(
                    (entry: ParsedEnvEntry) =>
                      (initialVars[entry.key] = entry.value)
                  );
                  return { ...prev, envVariables: initialVars };
                }
                console.log(
                  "[App.tsx] onLoad for manual-config: envVariables not empty, not overwriting."
                );
                return prev;
              });
            } else {
              console.log(
                "[App.tsx] onLoad for manual-config: No initial ENV (bundled) found."
              );
            }
          } catch (err) {
            console.error(
              "[App.tsx] onLoad for manual-config: Error pre-loading env vars:",
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
      title: "Installation Progress",
      component: InstallProgressSite,
    },
    {
      id: "control-panel",
      title: "Control Panel",
      component: ControlPanelSite,
    },
  ];

  const activeSites = sites.filter(
    (site) => !site.condition || site.condition(userSelections)
  );
  const currentSiteIndex = activeSites.findIndex(
    (site) => site.id === currentSiteId
  );
  const CurrentSiteComponent = activeSites[currentSiteIndex]?.component;

  // This useEffect handles onLoad for specific sites, keep it.
  useEffect(() => {
    const siteDef = activeSites[currentSiteIndex];
    if (siteDef && siteDef.title) {
      document.title = `DDALAB Setup - ${siteDef.title}`;
    }
    // Only call onLoad if currentSiteId is not 'loading'
    if (currentSiteId !== "loading" && siteDef && siteDef.onLoad) {
      // Add a more specific guard for the manual-config onLoad
      if (siteDef.id === "manual-config") {
        // Only call manual-config's onLoad if its specific conditions are met (e.g., data not yet loaded)
        // This uses the App.tsx's state for userSelections and parsedEnvEntries
        if (
          Object.keys(userSelections.envVariables).length === 0 ||
          parsedEnvEntries.length === 0
        ) {
          console.log(
            `[App.tsx] Calling onLoad for site: ${currentSiteId} (data seems empty, proceeding).`
          );
          siteDef.onLoad(electronAPI, setParsedEnvEntries, setUserSelections);
        } else {
          console.log(
            `[App.tsx] Skipping onLoad for site: ${currentSiteId} (data already present).`
          );
        }
      } else {
        // For other sites, call onLoad as before
        console.log(`[App.tsx] Calling onLoad for site: ${currentSiteId}`);
        siteDef.onLoad(electronAPI, setParsedEnvEntries, setUserSelections);
      }
    }
  }, [
    currentSiteId,
    activeSites,
    currentSiteIndex,
    electronAPI,
    setParsedEnvEntries,
    setUserSelections,
    userSelections, // Added userSelections to dependency array because the guard for manual-config's onLoad depends on it
    parsedEnvEntries, // Added parsedEnvEntries to dependency array for the same reason
  ]);

  const handleNext = async () => {
    const siteDef = activeSites[currentSiteIndex];
    let canProceed = true;

    // If on summary page, and about to proceed (to install-progress)
    if (siteDef?.id === "summary") {
      // Pre-flight checks for electronAPI and necessary functions
      if (!electronAPI) {
        console.error(
          "[App.tsx] electronAPI is not available. Cannot proceed with setup."
        );
        alert(
          "Critical error: electronAPI not available. Please restart the installer."
        );
        return;
      }
      if (typeof electronAPI.runInitialSetup !== "function") {
        console.error(
          "[App.tsx] electronAPI.runInitialSetup is not available or not a function!"
        );
        alert(
          "Critical error: runInitialSetup is not configured. Please check the preload script."
        );
        return;
      }
      if (
        typeof electronAPI.onSetupProgress !== "function" ||
        typeof electronAPI.onSetupFinished !== "function"
      ) {
        console.error(
          "[App.tsx] electronAPI.onSetupProgress or onSetupFinished is not available."
        );
        alert("Critical error: Setup progress listeners are not configured.");
        return;
      }

      // Add log to indicate we've reached the setup initiation point
      console.log("[App.tsx] Reached Summary, initiating setup process...");
      setUserSelections((prev) => ({
        ...prev,
        installationLog: ["Starting setup..."],
      }));

      // Setup listeners for progress and completion
      const removeProgressListener = electronAPI.onSetupProgress(
        (progress: { message: string; type?: string }) => {
          console.log("[App.tsx] Setup Progress:", progress);
          setUserSelections((prev) => {
            const currentLog = prev.installationLog || [];
            return {
              ...prev,
              installationLog: [...currentLog, progress.message],
            };
          });
        }
      );

      const removeFinishedListener = electronAPI.onSetupFinished(
        (state: { setupComplete: boolean; setupPath: string | null }) => {
          console.log("[App.tsx] Setup Finished. Final State:", state);
          setInstallationSuccess(state.setupComplete);
          setUserSelections((prev) => {
            const currentLog = prev.installationLog || [];
            return {
              ...prev,
              installationLog: [
                ...currentLog,
                state.setupComplete
                  ? "Setup completed successfully! Proceeding to Control Panel..."
                  : "Setup failed.",
              ],
            };
          });
          // Clean up listeners
          removeProgressListener();
          removeFinishedListener();
          // Potentially navigate to a final success/failure screen or enable a "Finish" button on InstallProgressSite
          if (state.setupComplete) {
            console.log(
              "[App.tsx] Navigating to control panel after successful setup."
            );
            setCurrentSiteId("control-panel");
          } else {
            // Optionally, navigate to an error/summary page or stay on install-progress to show logs.
            console.log(
              "[App.tsx] Setup failed. Staying on install-progress or current page to show logs."
            );
          }
        }
      );

      try {
        if (userSelections.setupType === "automatic") {
          console.log("[App.tsx] Automatic setup type selected.");
          if (!userSelections.dataLocation) {
            alert(
              "Data location for automatic setup is not selected. Please go back and select a directory."
            );
            // Clean up listeners as we are not proceeding
            removeProgressListener();
            removeFinishedListener();
            return; // Stop processing
          }
          // Construct DDALAB_ALLOWED_DIRS for automatic setup
          // Using userSelections.dataLocation as HOST_PATH and a default CONTAINER_PATH:PERMISSION
          // Example: /Users/your-name/Desktop/DDALAB_Data:/app/data/Desktop:ro
          const allowedDirsValue = `${userSelections.dataLocation}:/app/data/Desktop:ro`;
          console.log(
            "[App.tsx] DDALAB_ALLOWED_DIRS for automatic setup will be:",
            allowedDirsValue
          );

          console.log(
            "[App.tsx] Attempting to call window.electronAPI.runInitialSetup..."
          );
          // This is the main call to trigger the backend setup logic
          const setupResult = await electronAPI.runInitialSetup(
            allowedDirsValue
          );
          console.log(
            "[App.tsx] call to runInitialSetup completed. Result:",
            setupResult
          );

          if (!setupResult.success) {
            // Error already logged by onSetupFinished, but good to have direct result log
            alert(`Automatic setup failed: ${setupResult.message}`);
            // Installation success will be set by onSetupFinished
          } else {
            // Installation success will be set by onSetupFinished
          }
        } else if (userSelections.setupType === "manual") {
          // Manual setup: User has configured envVariables directly.
          // The .env file for this would typically be saved in a location chosen by the user,
          // or a default location for manual configs. The current saveEnvConfig handles this.
          console.log(
            "[App.tsx] Manual setup type selected. Saving .env configuration."
          );
          if (electronAPI.saveEnvConfig) {
            const envContent = generateEnvFileContent(
              userSelections.envVariables,
              parsedEnvEntries
            );
            // For manual setup, DDALAB-setup repo is NOT cloned by this installer.
            // The user is expected to have it or manage it themselves.
            // We are only saving the .env content they configured.
            // Where should it be saved? For now, it uses the existing logic of saveEnvConfig (targetDir=null implies default).
            electronAPI.saveEnvConfig(null, envContent); // targetDir = null uses default path in main
            console.log(
              "[App.tsx] Manual .env configuration saved (using saveEnvConfig)."
            );

            // Now, mark the setup as complete in the installer state
            if (electronAPI.markSetupComplete) {
              console.log(
                "[App.tsx] Attempting to mark manual setup as complete..."
              );
              const markResult = await electronAPI.markSetupComplete();
              if (markResult.success) {
                console.log(
                  "[App.tsx] Manual setup successfully marked as complete."
                );
                setInstallationSuccess(true);
                setUserSelections((prev) => {
                  const currentLog = prev.installationLog || [];
                  return {
                    ...prev,
                    installationLog: [
                      ...currentLog,
                      "Manual .env configuration saved and setup marked as complete.",
                    ],
                  };
                });
                // Navigate to control panel after successful manual setup
                console.log(
                  "[App.tsx] Navigating to control panel after manual setup."
                );
                setCurrentSiteId("control-panel");
              } else {
                console.error(
                  "[App.tsx] Failed to mark manual setup as complete:",
                  markResult.message
                );
                alert(
                  `Error: Could not finalize manual setup. ${markResult.message}`
                );
                setInstallationSuccess(false); // Ensure failure is registered
                setUserSelections((prev) => ({
                  ...prev,
                  installationLog: [
                    ...(prev.installationLog || []),
                    `Failed to mark setup as complete: ${markResult.message}`,
                  ],
                }));
                // Do not proceed with listeners if marking setup failed
                removeProgressListener();
                removeFinishedListener();
                return;
              }
            } else {
              console.error(
                "[App.tsx] electronAPI.markSetupComplete is not available!"
              );
              alert(
                "Critical error: Cannot finalize manual setup. API not available."
              );
              setInstallationSuccess(false);
              // Do not proceed with listeners if API is missing
              removeProgressListener();
              removeFinishedListener();
              return;
            }
          } else {
            console.error(
              "[App.tsx] electronAPI.saveEnvConfig is not available for manual setup!"
            );
            alert("Cannot save manual .env configuration. API not available.");
            removeProgressListener(); // Clean up listeners
            removeFinishedListener();
            return;
          }
        }

        // The actual saveEnvConfig for the *project root* seems to be for a different purpose
        // than the .env inside the DDALAB-setup directory. Let's re-evaluate its necessity here.
        // For now, let's assume it might be for the installer's own settings or an overarching project.

        // This block seems to be a general .env save, possibly for the project root.
        // It was outside the automatic/manual conditional block earlier. Let's ensure it runs only if no critical error occurred before it.
        // However, for manual setup, the primary actions (saveEnvConfig for manual path and markSetupComplete) are done.
        // The navigation to control-panel for manual path is handled above.
        // If an error occurred in the manual path before this, we would have returned.

        // If the setup was automatic, the flow is handled by runInitialSetup and its listeners.
        // If the setup was manual, we've already navigated or returned.
        // This means this saveEnvConfig call below might only be relevant if it's a common operation *after* either path *and* if no navigation/return happened.
        // Given that manual setup now navigates, this might not be reached for manual flow unless setCurrentSiteId is async and code continues.
        // To be safe, let's condition this original saveEnvConfig as well.

        if (userSelections.setupType === "automatic") {
          // For automatic setup, runInitialSetup handles the .env within the cloned repo.
          // This outer saveEnvConfig might be for a different purpose, e.g. saving some global settings.
          // Let's assume it's still desired for automatic setup if it was there before.
          if (electronAPI.saveEnvConfig) {
            const envContent = generateEnvFileContent(
              userSelections.envVariables,
              parsedEnvEntries
            );
            console.log(
              "[App.tsx] Attempting to call electronAPI.saveEnvConfig (for project root or similar - automatic path). Content:",
              envContent
            );
            electronAPI.saveEnvConfig(null, envContent);
            console.log(
              "[App.tsx] electronAPI.saveEnvConfig called (automatic path context)."
            );
          } else {
            console.warn(
              "[App.tsx] electronAPI.saveEnvConfig not available (automatic path context), skipping this step."
            );
          }
        } else if (userSelections.setupType === "manual") {
          // For manual setup, the .env specifically for the manual config was saved above.
          // This general saveEnvConfig call might be redundant or for a different .env.
          // If it's meant to be the same, it's already done.
          // If it's for a *different* .env (e.g. project root), it could still run.
          // For clarity, let's assume this was a general save and might still be intended.
          // However, ensure it doesn't run if we already returned due to an error in markSetupComplete.
          // The control flow above for manual already handles return on error.
          if (electronAPI.saveEnvConfig) {
            const envContent = generateEnvFileContent(
              userSelections.envVariables, // These are the manually entered vars
              parsedEnvEntries
            );
            console.log(
              "[App.tsx] Attempting to call general electronAPI.saveEnvConfig (manual path context). Content:",
              envContent
            );
            electronAPI.saveEnvConfig(null, envContent);
            console.log(
              "[App.tsx] General electronAPI.saveEnvConfig called (manual path context)."
            );
          } else {
            console.warn(
              "[App.tsx] General electronAPI.saveEnvConfig not available (manual path context), skipping this step."
            );
          }
        }
      } catch (error: any) {
        console.error(
          "[App.tsx] Error during setup process on summary page:",
          error
        );
        alert(`An error occurred during setup: ${error.message}`);
        setInstallationSuccess(false);
        setUserSelections((prev) => {
          const currentLog = prev.installationLog || [];
          return {
            ...prev,
            installationLog: [...currentLog, `Error: ${error.message}`],
          };
        });
        // Clean up listeners in case of an overarching error
        removeProgressListener();
        removeFinishedListener();
        return; // Stop processing to prevent moving to next site if there was a major error
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

  if (currentSiteId === "loading") {
    return <div>Loading application state...</div>; // Or a proper loading spinner component
  }

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
