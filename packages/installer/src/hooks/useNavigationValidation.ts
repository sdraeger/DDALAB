import { useMemo } from "react";
import type { UserSelections, ParsedEnvEntry } from "../utils";

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
        case "manual-config":
          const hasConfig =
            Object.keys(userSelections.envVariables).length > 0 ||
            parsedEnvEntries.length > 0;
          return {
            enabled: hasConfig,
            message: !hasConfig
              ? "Please configure environment variables"
              : undefined,
          };
        case "summary":
          const hasSetupType = !!userSelections.setupType;
          const hasDataLocation =
            userSelections.setupType === "automatic"
              ? !!userSelections.dataLocation
              : true;
          const hasEnvConfig =
            userSelections.setupType === "manual"
              ? Object.keys(userSelections.envVariables).length > 0 ||
                parsedEnvEntries.length > 0
              : true;
          const allValid = hasSetupType && hasDataLocation && hasEnvConfig;
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
