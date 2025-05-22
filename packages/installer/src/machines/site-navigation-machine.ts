import { createMachine, assign } from "xstate";
import type { UserSelections, ParsedEnvEntry } from "../utils";

interface SiteNavigationContext {
  currentSite: string;
  userSelections: UserSelections;
  parsedEnvEntries: ParsedEnvEntry[];
  installationSuccess: boolean | null;
}

type SiteNavigationEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "UPDATE_SELECTIONS"; selections: Partial<UserSelections> }
  | { type: "UPDATE_ENV_ENTRIES"; entries: ParsedEnvEntry[] }
  | { type: "SET_INSTALLATION_SUCCESS"; success: boolean }
  | { type: "GOTO_SITE"; site: string };

export const siteNavigationMachine = createMachine<
  SiteNavigationContext,
  SiteNavigationEvent
>({
  id: "siteNavigation",
  initial: "loading",
  context: {
    currentSite: "loading",
    userSelections: {
      setupType: "automatic",
      dataLocation: "",
      envVariables: {},
      installationLog: [],
    },
    parsedEnvEntries: [],
    installationSuccess: null,
  },
  states: {
    loading: {
      on: {
        GOTO_SITE: {
          target: "active",
          actions: assign({
            currentSite: (_, event) => event.site,
          }),
        },
      },
    },
    active: {
      on: {
        NEXT: {
          actions: assign((context) => {
            let nextSite = context.currentSite;

            switch (context.currentSite) {
              case "welcome":
                // Choose path based on setup type
                nextSite =
                  context.userSelections.setupType === "automatic"
                    ? "data-location"
                    : "manual-config";
                break;
              case "data-location":
                nextSite = "summary";
                break;
              case "manual-config":
                nextSite = "summary";
                break;
              case "summary":
                nextSite = "control-panel";
                break;
              default:
                // Stay on current site if no next site defined
                break;
            }

            return {
              currentSite: nextSite,
            };
          }),
        },
        BACK: {
          actions: assign((context) => {
            let previousSite = context.currentSite;

            switch (context.currentSite) {
              case "data-location":
                previousSite = "welcome";
                break;
              case "manual-config":
                previousSite = "welcome";
                break;
              case "summary":
                // Go back based on setup type
                previousSite =
                  context.userSelections.setupType === "automatic"
                    ? "data-location"
                    : "manual-config";
                break;
              case "control-panel":
                previousSite = "summary";
                break;
              default:
                // Stay on current site if no previous site defined
                break;
            }

            return {
              currentSite: previousSite,
            };
          }),
        },
        GOTO_SITE: {
          actions: assign({
            currentSite: (_, event) => event.site,
          }),
        },
        UPDATE_SELECTIONS: {
          actions: assign({
            userSelections: (context, event) => ({
              ...context.userSelections,
              ...event.selections,
            }),
          }),
        },
        UPDATE_ENV_ENTRIES: {
          actions: assign({
            parsedEnvEntries: (_, event) => event.entries,
          }),
        },
        SET_INSTALLATION_SUCCESS: {
          actions: assign({
            installationSuccess: (_, event) => event.success,
          }),
        },
      },
    },
  },
});
