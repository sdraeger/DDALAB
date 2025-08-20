import { createMachine, assign } from "xstate";
import type { UserSelections, ParsedEnvEntry } from "../utils/electron";

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
      setupType: "docker",
      dataLocation: "",
      projectLocation: "",
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
                if (context.userSelections.setupType === "docker") {
                  nextSite = "data-location";
                } else if (context.userSelections.setupType === "manual") {
                  nextSite = "manual-config";
                } else {
                  // Legacy "automatic" setup type
                  nextSite = "data-location";
                }
                break;
              case "data-location":
                if (context.userSelections.setupType === "docker") {
                  nextSite = "clone-location";
                } else if (context.userSelections.setupType === "manual") {
                  nextSite = "summary";
                } else {
                  // Legacy "automatic" setup type
                  nextSite = "clone-location";
                }
                break;
              case "clone-location":
                if (context.userSelections.setupType === "docker") {
                  nextSite = "docker-config";
                } else {
                  nextSite = "summary";
                }
                break;
              case "docker-config":
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
              case "clone-location":
                previousSite = "data-location";
                break;
              case "docker-config":
                previousSite = "clone-location";
                break;
              case "manual-config":
                previousSite = "welcome";
                break;
              case "summary":
                // Go back based on setup type
                if (context.userSelections.setupType === "docker") {
                  previousSite = "docker-config";
                } else if (context.userSelections.setupType === "manual") {
                  previousSite = "manual-config";
                } else {
                  // Legacy "automatic" setup type
                  previousSite = "clone-location";
                }
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
