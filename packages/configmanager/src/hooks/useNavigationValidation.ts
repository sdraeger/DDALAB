import { useMemo } from "react";
import type { UserSelections, ParsedEnvEntry } from "../utils/electron";

interface NavigationValidationState {
  isNextButtonEnabled: boolean;
  isBackButtonEnabled: boolean;
  shouldShowNextButton: boolean;
  shouldShowFinishButton: boolean;
  validationMessage?: string;
}

export const useNavigationValidation = (
  currentSite: string,
  userSelections: UserSelections,
  parsedEnvEntries: ParsedEnvEntry[],
  isLoading: boolean = false
): NavigationValidationState => {
  return useMemo(() => {
    // Helper function to validate next button
    const getNextButtonState = (): { enabled: boolean; message?: string } => {
      if (isLoading) return { enabled: false, message: "Processing..." };

      switch (currentSite) {
        case "welcome":
          return {
            enabled: !!userSelections.setupType,
            message: !userSelections.setupType
              ? "Please select a setup type"
              : undefined,
          };
        case "data-location":
          return {
            enabled: !!userSelections.dataLocation,
            message: !userSelections.dataLocation
              ? "Please select a data location"
              : undefined,
          };
        case "clone-location":
          return {
            enabled: !!userSelections.cloneLocation,
            message: !userSelections.cloneLocation
              ? "Please select a clone location"
              : undefined,
          };
        case "docker-config":
          // For Docker config, we can proceed as long as we have the basic setup
          const hasBasicSetup =
            !!userSelections.dataLocation && !!userSelections.cloneLocation;
          return {
            enabled: hasBasicSetup,
            message: !hasBasicSetup
              ? "Please complete the previous steps first"
              : undefined,
          };
        case "manual-config":
          // For manual config, we just need a directory to be selected
          // The actual setup completion will happen when Next is clicked
          const hasSelection =
            !!userSelections.dataLocation ||
            Object.keys(userSelections.envVariables).length > 0 ||
            parsedEnvEntries.length > 0;
          return {
            enabled: hasSelection,
            message: !hasSelection
              ? "Please select a directory first"
              : undefined,
          };
        case "summary":
          const hasSetupType = !!userSelections.setupType;
          const hasDataLocation = !!userSelections.dataLocation;
          const hasCloneLocation =
            userSelections.setupType === "docker"
              ? !!userSelections.cloneLocation
              : userSelections.setupType === "manual"
              ? true
              : !!userSelections.cloneLocation;
          const hasEnvConfig =
            userSelections.setupType === "manual"
              ? Object.keys(userSelections.envVariables).length > 0 ||
                parsedEnvEntries.length > 0
              : true;
          const allValid =
            hasSetupType && hasDataLocation && hasCloneLocation && hasEnvConfig;
          return {
            enabled: allValid,
            message: !allValid
              ? "Please complete all previous steps"
              : undefined,
          };
        case "control-panel":
          return { enabled: false };
        default:
          return { enabled: false };
      }
    };

    // Helper function to validate back button
    const getBackButtonState = (): boolean => {
      if (isLoading) return false;

      switch (currentSite) {
        case "welcome":
        case "loading":
        case "control-panel":
          return false;
        default:
          return true;
      }
    };

    // Helper functions for button visibility
    const shouldShowNext = (): boolean => {
      return !["summary", "control-panel"].includes(currentSite);
    };

    const shouldShowFinish = (): boolean => {
      return currentSite === "summary";
    };

    const nextState = getNextButtonState();

    return {
      isNextButtonEnabled: nextState.enabled,
      isBackButtonEnabled: getBackButtonState(),
      shouldShowNextButton: shouldShowNext(),
      shouldShowFinishButton: shouldShowFinish(),
      validationMessage: nextState.message,
    };
  }, [currentSite, userSelections, parsedEnvEntries, isLoading]);
};
