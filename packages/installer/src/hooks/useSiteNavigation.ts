import { useContext } from "react";
import { SiteNavigationContext } from "../context/SiteNavigationContext";
import type { UserSelections, ParsedEnvEntry } from "../utils";

export const useSiteNavigation = () => {
  const { state, send } = useContext(SiteNavigationContext);

  return {
    currentSite: state.context.currentSite,
    userSelections: state.context.userSelections,
    parsedEnvEntries: state.context.parsedEnvEntries,
    installationSuccess: state.context.installationSuccess,

    goToNextSite: () => {
      send("NEXT");
    },
    goToPreviousSite: () => {
      send("BACK");
    },
    goToSite: (site: string) => {
      send({ type: "GOTO_SITE", site });
    },

    updateSelections: (selections: Partial<UserSelections>) => {
      send({ type: "UPDATE_SELECTIONS", selections });
    },

    updateEnvEntries: (
      entries: ParsedEnvEntry[] | ((prev: ParsedEnvEntry[]) => ParsedEnvEntry[])
    ) => {
      const newEntries =
        typeof entries === "function"
          ? entries(state.context.parsedEnvEntries)
          : entries;
      send({ type: "UPDATE_ENV_ENTRIES", entries: newEntries });
    },

    setInstallationSuccess: (success: boolean) => {
      send({ type: "SET_INSTALLATION_SUCCESS", success });
    },
  };
};
