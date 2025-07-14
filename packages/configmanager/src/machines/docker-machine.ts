import { createMachine, assign } from "xstate";

interface DockerContext {
  status: string;
  logs: string[];
  isTraefikHealthy: boolean;
  lastError?: string;
  allServicesHealthy: boolean;
}

type DockerEvent =
  | { type: "START_DOCKER" }
  | { type: "STOP_DOCKER" }
  | { type: "DOCKER_STARTED" }
  | { type: "DOCKER_STOPPED" }
  | { type: "SERVICES_READY" }
  | { type: "SERVICES_UNHEALTHY" }
  | { type: "FETCH_LOGS" }
  | { type: "STATUS_UPDATE"; statusUpdate: { type: string; message: string } }
  | {
      type: "LOG_UPDATE";
      logUpdate: { type: string; message: string; logs?: string };
    }
  | { type: "ERROR"; error: string };

export const dockerMachine = createMachine<DockerContext, DockerEvent>({
  id: "docker",
  initial: "unknown",
  context: {
    status: "Unknown",
    logs: [],
    isTraefikHealthy: false,
    allServicesHealthy: false,
  },
  states: {
    unknown: {
      entry: assign({
        status: () => "Unknown",
        isTraefikHealthy: () => false,
      }),
      on: {
        START_DOCKER: "starting",
        SERVICES_READY: "runningHealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => ({
              logs: [
                ...context.logs,
                `[${event.statusUpdate.type.toUpperCase()}] ${
                  event.statusUpdate.message
                }`,
              ],
            })),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    starting: {
      entry: assign({
        status: () => "Starting...",
        isTraefikHealthy: () => false,
        lastError: () => undefined,
      }),
      on: {
        DOCKER_STARTED: "running",
        SERVICES_READY: "runningHealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => {
              const msgLc = event.statusUpdate.message.toLowerCase();
              let newStatus = context.status;

              if (
                event.statusUpdate.type === "info" &&
                msgLc.includes("starting")
              ) {
                newStatus = "Starting...";
              } else if (
                event.statusUpdate.type === "success" &&
                msgLc.includes("started")
              ) {
                newStatus = "Running";
              }

              return {
                status: newStatus,
                logs: [
                  ...context.logs,
                  `[${event.statusUpdate.type.toUpperCase()}] ${
                    event.statusUpdate.message
                  }`,
                ],
              };
            }),
          ],
          target: "running",
          cond: (_, event) =>
            event.statusUpdate.type === "success" &&
            event.statusUpdate.message.toLowerCase().includes("started"),
        },
        ERROR: {
          target: "error",
          actions: [
            assign({
              status: () => "Error starting",
              lastError: (_, event) => event.error,
              logs: (context, event) => [
                ...context.logs,
                `[ERROR] ${event.error}`,
              ],
            }),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    running: {
      entry: assign({
        status: () => "Running",
      }),
      on: {
        STOP_DOCKER: "stopping",
        SERVICES_READY: "runningHealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => {
              const msgLc = event.statusUpdate.message.toLowerCase();
              let newStatus = context.status;

              if (
                event.statusUpdate.type === "info" &&
                msgLc.includes("checking traefik health")
              ) {
                newStatus = "Running (Checking Health)";
              }

              return {
                status: newStatus,
                logs: [
                  ...context.logs,
                  `[${event.statusUpdate.type.toUpperCase()}] ${
                    event.statusUpdate.message
                  }`,
                ],
              };
            }),
          ],
          target: "runningCheckingHealth",
          cond: (_, event) =>
            event.statusUpdate.type === "info" &&
            event.statusUpdate.message
              .toLowerCase()
              .includes("checking traefik health"),
        },
        ERROR: {
          target: "error",
          actions: [
            assign({
              status: () => "Error",
              lastError: (_, event) => event.error,
              isTraefikHealthy: () => false,
              logs: (context, event) => [
                ...context.logs,
                `[ERROR] ${event.error}`,
              ],
            }),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    runningCheckingHealth: {
      entry: assign({
        status: () => "Running (Checking Health)",
      }),
      on: {
        STOP_DOCKER: "stopping",
        SERVICES_READY: "runningHealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => ({
              logs: [
                ...context.logs,
                `[${event.statusUpdate.type.toUpperCase()}] ${
                  event.statusUpdate.message
                }`,
              ],
            })),
          ],
        },
        ERROR: {
          target: "error",
          actions: [
            assign({
              status: () => "Error",
              lastError: (_, event) => event.error,
              isTraefikHealthy: () => false,
              logs: (context, event) => [
                ...context.logs,
                `[ERROR] ${event.error}`,
              ],
            }),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    runningHealthy: {
      entry: assign({
        status: () => "Running (All Services Healthy)",
        isTraefikHealthy: () => true,
        allServicesHealthy: () => true,
      }),
      on: {
        STOP_DOCKER: "stopping",
        SERVICES_UNHEALTHY: "runningUnhealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => ({
              logs: [
                ...context.logs,
                `[${event.statusUpdate.type.toUpperCase()}] ${
                  event.statusUpdate.message
                }`,
              ],
            })),
          ],
        },
        ERROR: {
          target: "error",
          actions: [
            assign({
              status: () => "Error",
              lastError: (_, event) => event.error,
              isTraefikHealthy: () => false,
              allServicesHealthy: () => false,
              logs: (context, event) => [
                ...context.logs,
                `[ERROR] ${event.error}`,
              ],
            }),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    runningUnhealthy: {
      entry: assign({
        status: () => "Running (Some Services Unhealthy)",
        allServicesHealthy: () => false,
      }),
      on: {
        STOP_DOCKER: "stopping",
        SERVICES_READY: "runningHealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => ({
              logs: [
                ...context.logs,
                `[${event.statusUpdate.type.toUpperCase()}] ${
                  event.statusUpdate.message
                }`,
              ],
            })),
          ],
        },
        ERROR: {
          target: "error",
          actions: [
            assign({
              status: () => "Error",
              lastError: (_, event) => event.error,
              isTraefikHealthy: () => false,
              allServicesHealthy: () => false,
              logs: (context, event) => [
                ...context.logs,
                `[ERROR] ${event.error}`,
              ],
            }),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    stopping: {
      entry: assign({
        status: () => "Stopping...",
        lastError: () => undefined,
      }),
      on: {
        DOCKER_STOPPED: "stopped",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => {
              const msgLc = event.statusUpdate.message.toLowerCase();
              let newStatus = context.status;

              if (
                event.statusUpdate.type === "info" &&
                msgLc.includes("stopping")
              ) {
                newStatus = "Stopping...";
              } else if (
                event.statusUpdate.type === "success" &&
                msgLc.includes("stopped")
              ) {
                newStatus = "Stopped";
              }

              return {
                status: newStatus,
                logs: [
                  ...context.logs,
                  `[${event.statusUpdate.type.toUpperCase()}] ${
                    event.statusUpdate.message
                  }`,
                ],
              };
            }),
          ],
          target: "stopped",
          cond: (_, event) =>
            event.statusUpdate.type === "success" &&
            event.statusUpdate.message.toLowerCase().includes("stopped"),
        },
        ERROR: {
          target: "error",
          actions: [
            assign({
              status: () => "Error stopping",
              lastError: (_, event) => event.error,
              logs: (context, event) => [
                ...context.logs,
                `[ERROR] ${event.error}`,
              ],
            }),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    stopped: {
      entry: assign({
        status: () => "Stopped",
        isTraefikHealthy: () => false,
      }),
      on: {
        START_DOCKER: "starting",
        SERVICES_READY: "runningHealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => ({
              logs: [
                ...context.logs,
                `[${event.statusUpdate.type.toUpperCase()}] ${
                  event.statusUpdate.message
                }`,
              ],
            })),
          ],
          target: "starting",
          cond: (_, event) =>
            event.statusUpdate.type === "info" &&
            event.statusUpdate.message.toLowerCase().includes("starting"),
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
    error: {
      on: {
        START_DOCKER: "starting",
        SERVICES_READY: "runningHealthy",
        STATUS_UPDATE: {
          actions: [
            assign((context, event) => ({
              logs: [
                ...context.logs,
                `[${event.statusUpdate.type.toUpperCase()}] ${
                  event.statusUpdate.message
                }`,
              ],
            })),
          ],
        },
        LOG_UPDATE: {
          actions: [
            assign((context, event) => {
              let logsToAdd = `[${event.logUpdate.type.toUpperCase()}] ${
                event.logUpdate.message
              }`;
              if (event.logUpdate.logs) {
                logsToAdd += `\n--- Begin Fetched Logs ---\n${event.logUpdate.logs}\n--- End Fetched Logs ---`;
              }
              return {
                logs: [...context.logs, logsToAdd],
              };
            }),
          ],
        },
      },
    },
  },
  on: {
    FETCH_LOGS: {
      actions: [
        assign((context) => ({
          logs: [
            ...context.logs,
            `[ACTION] Fetching recent logs... (${new Date().toLocaleTimeString()})`,
          ],
        })),
      ],
    },
  },
});
