import { app } from "electron";
import path from "path";
import { exec } from "child_process";
import { BrowserWindow, ipcMain } from "electron";

import { initializeAppLifecycle } from "./src/utils/app-lifecycle";
import { registerFileSystemIpcHandlers } from "./src/ipc/file-system-ipc";
import { registerDialogIpcHandlers } from "./src/ipc/dialog-ipc";
import { registerInstallerIpcHandlers } from "./src/ipc/installer-ipc";
import { registerEnvIpcHandlers } from "./src/ipc/env-ipc";
import { registerDockerIpcHandlers } from "./src/ipc/docker-ipc";
import { PROJECT_ROOT_ENV_PATH } from "./src/utils/env-manager";

console.log("[main.ts] Script execution started");
console.log(`[main.ts] Initializing Paths:`);
console.log(`  __dirname: ${__dirname}`);
console.log(
  `  PROJECT_ROOT_ENV_PATH (from env-manager): ${PROJECT_ROOT_ENV_PATH}`
);

// Initialize application lifecycle management (this will call createWindow)
initializeAppLifecycle();

// Register all IPC handlers
registerFileSystemIpcHandlers();
registerDialogIpcHandlers();
registerInstallerIpcHandlers();
registerEnvIpcHandlers();
registerDockerIpcHandlers();

// This should be your actual main application window
let mainWindow: BrowserWindow | null = null;

// Call this function when your main window is created and ready
export function setMainWindow(win: BrowserWindow) {
  console.log("[main.ts] setMainWindow called with window ID:", win.id);
  mainWindow = win;
}

// Function to get the project name (directory name of the docker-compose.yml)
function getDockerProjectName(): string {
  // Assuming docker-compose.yml is in /Users/simon/Desktop/DDALAB/
  // Adjust if your docker-compose.yml is elsewhere relative to the project root for compose
  const composeFilePath = "/Users/simon/Desktop/DDALAB/docker-compose.yml"; // Or a more dynamic way to get this
  const path = require("path");
  // Docker Compose typically uses the directory name of the compose file as the project name by default.
  // Or, if you use `docker-compose -p <projectname> up`, that projectname is used.
  // We'll assume the directory name for now.
  return path
    .basename(path.dirname(composeFilePath))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function getTraefikContainerId(
  projectName: string
): Promise<string | null> {
  return new Promise((resolve) => {
    // The -p flag is not strictly needed for `ps` if compose knows the project context,
    // but using project name for clarity.
    // Make sure docker-compose.yml is in the CWD or specify with -f
    const command = `docker-compose -f /Users/simon/Desktop/DDALAB/docker-compose.yml -p ${projectName} ps -q traefik`;
    console.log(`[main.ts] Executing command to get Traefik ID: ${command}`);
    exec(
      command,
      { cwd: "/Users/simon/Desktop/DDALAB" },
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `[main.ts] Error executing 'docker-compose ps' for Traefik ID: ${error.message}. Stderr: ${stderr}. Command: ${command}`
          );
          if (mainWindow) {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Failed to get Traefik ID (exec error): ${
                stderr || error.message
              }`,
            });
          }
          console.log(
            "[main.ts] getTraefikContainerId resolving with null due to exec error."
          );
          resolve(null);
          return;
        }
        const containerId = stdout.trim();
        if (containerId) {
          console.log(
            `[main.ts] 'docker-compose ps -q traefik' stdout: '${stdout}'. Trimmed ID: '${containerId}'. Resolving with ID.`
          );
          resolve(containerId);
        } else {
          console.error(
            `[main.ts] Traefik container ID not found from 'docker-compose ps -q traefik'. stdout was: '${stdout}'. stderr was: '${stderr}'. Command: ${command}`
          );
          if (mainWindow) {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message:
                "Traefik container not found after startup (empty ps output).",
            });
          }
          console.log(
            "[main.ts] getTraefikContainerId resolving with null because ID was empty."
          );
          resolve(null);
        }
      }
    );
  });
}

async function checkTraefikHealth(
  containerId: string,
  attempt = 0
): Promise<void> {
  const maxAttempts = 60; // Poll for 5 minutes (60 attempts * 5 seconds)
  const retryDelay = 5000; // 5 seconds

  if (!mainWindow) {
    console.error(
      "[main.ts] mainWindow not available for sending IPC for Traefik health."
    );
    return;
  }
  if (!containerId) {
    console.error(
      "[main.ts] No Traefik container ID provided for health check."
    );
    if (mainWindow) {
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: "Cannot check Traefik health: Missing container ID.",
      });
    }
    return;
  }

  const command = `docker inspect --format='{{json .State.Health.Status}}' ${containerId}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(
        `[main.ts] Error inspecting Traefik (${containerId}): ${stderr}`
      );
      if (attempt < maxAttempts) {
        setTimeout(
          () => checkTraefikHealth(containerId, attempt + 1),
          retryDelay
        );
      } else {
        console.error(
          "[main.ts] Max attempts reached for Traefik health check."
        );
        if (mainWindow) {
          mainWindow.webContents.send("docker-status-update", {
            type: "error",
            message: `Traefik (${containerId}) health check timed out: ${stderr}`,
          });
        }
      }
      return;
    }

    try {
      const statusOutput = stdout.trim();
      // Log the raw output before attempting to parse
      console.log(
        `[main.ts] Raw Traefik health status output for ${containerId}: '${statusOutput}'`
      );

      // Docker's --format='{{json .State.Health.Status}}' should already provide a valid JSON string (e.g., ""healthy"")
      const status = JSON.parse(statusOutput);

      console.log(
        `[main.ts] Parsed Traefik (${containerId}) health status: ${status} (type: ${typeof status})`
      );

      if (status === "healthy") {
        console.log(
          `[main.ts] Traefik (${containerId}) is healthy. All services should be ready.`
        );
        if (mainWindow) {
          mainWindow.webContents.send("all-services-ready");
        }
      } else {
        if (attempt < maxAttempts) {
          if (status === "unhealthy") {
            console.warn(
              `[main.ts] Traefik (${containerId}) reported unhealthy. Retrying...`
            );
          } else {
            // Added else block to log other non-healthy statuses before retrying
            console.log(
              `[main.ts] Traefik (${containerId}) status is '${status}'. Retrying...`
            );
          }
          setTimeout(
            () => checkTraefikHealth(containerId, attempt + 1),
            retryDelay
          );
        } else {
          console.error(
            `[main.ts] Max attempts reached. Traefik (${containerId}) not healthy (current: ${status}).`
          );
          if (mainWindow) {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Traefik (${containerId}) did not become healthy in time (status: ${status}).`,
            });
          }
        }
      }
    } catch (parseError) {
      console.error(
        `[main.ts] Error parsing Traefik health status for ${containerId} (raw: '${stdout.trim()}'): ${parseError}`
      );
      if (attempt < maxAttempts) {
        setTimeout(
          () => checkTraefikHealth(containerId, attempt + 1),
          retryDelay
        );
      }
    }
  });
}

ipcMain.handle("start-docker-compose", async () => {
  console.log('[main.ts] IPC event "start-docker-compose" received.');
  if (!mainWindow) {
    console.error("[main.ts] Cannot start Docker Compose: mainWindow not set.");
    return false;
  }
  const projectName = getDockerProjectName();
  const composeFile = "/Users/simon/Desktop/DDALAB/docker-compose.yml"; // Ensure this path is correct
  const composeCommand = `docker-compose -f "${composeFile}" -p ${projectName} up -d`;

  if (mainWindow) {
    mainWindow.webContents.send("docker-status-update", {
      type: "info",
      message: `Starting Docker services (project: ${projectName})... Command: ${composeCommand}`,
    });
  }

  return new Promise((resolvePromise) => {
    // Renamed resolve to resolvePromise to avoid conflict
    exec(
      composeCommand,
      { cwd: "/Users/simon/Desktop/DDALAB" },
      async (error, stdout, stderr) => {
        if (error) {
          console.error(`[main.ts] Error starting docker-compose: ${stderr}`);
          if (mainWindow) {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Failed to start Docker: ${stderr}`,
            });
          }
          resolvePromise(false);
          return;
        }
        console.log(
          `[main.ts] Docker-compose up initiated for project ${projectName}: ${stdout}`
        );
        if (mainWindow) {
          mainWindow.webContents.send("docker-status-update", {
            type: "info",
            message: "Docker services initiated. Checking Traefik status...",
          });
        }

        // Add a small delay before trying to get the container ID
        console.log(
          "[main.ts] Waiting a few seconds before fetching Traefik container ID..."
        );
        await new Promise((r) => setTimeout(r, 3000)); // 3-second delay

        console.log("[main.ts] Attempting to get Traefik container ID...");
        const traefikContainerId = await getTraefikContainerId(projectName);

        if (traefikContainerId) {
          console.log(
            `[main.ts] Obtained Traefik container ID: '${traefikContainerId}'. Starting health check.`
          );
          checkTraefikHealth(traefikContainerId);
        } else {
          console.error(
            "[main.ts] Failed to obtain Traefik container ID after delay. Health check not started."
          );
        }
        resolvePromise(true);
      }
    );
  });
});

// Ensure setMainWindow is called. For example, in your main window creation logic:
// app.whenReady().then(() => {
//   const win = createWindow(); // Your existing window creation
//   setMainWindow(win);       // Set the main window instance here
// });
