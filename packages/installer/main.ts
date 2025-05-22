import { app } from "electron";
import { exec } from "child_process";
import { BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs/promises";

import { initializeAppLifecycle } from "./src/utils/app-lifecycle";
import { registerFileSystemIpcHandlers } from "./src/ipc/file-system-ipc";
import { registerDialogIpcHandlers } from "./src/ipc/dialog-ipc";
import { registerInstallerIpcHandlers } from "./src/ipc/installer-ipc";
import { registerEnvIpcHandlers } from "./src/ipc/env-ipc";
import { registerDockerIpcHandlers } from "./src/ipc/docker-ipc";
import { PROJECT_ROOT_ENV_PATH } from "./src/utils/env-manager";

// --- BEGIN DDALAB Setup Constants ---
const DDALAB_SETUP_REPO_URL = "https://github.com/sdraeger/DDALAB-setup.git";
const DDALAB_SETUP_DIR_NAME = "ddalab-setup-data";
const INSTALLER_STATE_FILE_NAME = "installer-state.json";

function getSetupDataDir(): string {
  return path.join(app.getPath("userData"), DDALAB_SETUP_DIR_NAME);
}

function getInstallerStateFilePath(): string {
  return path.join(app.getPath("userData"), INSTALLER_STATE_FILE_NAME);
}

interface InstallerState {
  setupComplete: boolean;
  setupPath: string | null;
}
// --- END DDALAB Setup Constants ---

console.log("[main.ts] Script execution started");
console.log(`[main.ts] Initializing Paths:`);
console.log(`  __dirname: ${__dirname}`);
console.log(`  userData path: ${app.getPath("userData")}`);
console.log(
  `  PROJECT_ROOT_ENV_PATH (from env-manager): ${PROJECT_ROOT_ENV_PATH}`
);

// --- BEGIN Installer State Management ---
async function getInstallerState(): Promise<InstallerState> {
  const stateFilePath = getInstallerStateFilePath();
  console.log("[main.ts] Reading installer state from:", stateFilePath);
  try {
    const data = await fs.readFile(stateFilePath, "utf-8");
    console.log(
      "[main.ts] Successfully read raw data from state file. Length:",
      data.length
    );
    try {
      const state = JSON.parse(data);
      console.log("[main.ts] Parsed installer state:", state);
      // Basic validation
      if (
        typeof state.setupComplete === "boolean" &&
        (state.setupPath === null || typeof state.setupPath === "string")
      ) {
        console.log("[main.ts] Successfully parsed installer state:", state);
        return state;
      }
      console.warn(
        "[main.ts] Installer state file format is invalid after parsing. Resetting. State was:",
        state
      );
      return { setupComplete: false, setupPath: null };
    } catch (parseError: any) {
      console.error(
        `[main.ts] Error parsing JSON from installer state file (${stateFilePath}). Raw data: '${data.substring(
          0,
          200
        )}...':`,
        parseError
      );
      return { setupComplete: false, setupPath: null }; // Treat parse error as invalid state
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(
        `[main.ts] Installer state file not found at ${stateFilePath}. Assuming first run.`
      );
    } else {
      console.error(
        `[main.ts] Error reading installer state file ${stateFilePath}:`,
        error
      );
    }
    return { setupComplete: false, setupPath: null };
  }
}

async function saveInstallerState(setupPath: string | null): Promise<void> {
  const userDataPath = app.getPath("userData"); // Get the base user data path
  const stateFilePath = path.join(userDataPath, INSTALLER_STATE_FILE_NAME); // Construct the full file path
  const state: InstallerState = { setupComplete: true, setupPath };
  try {
    // Ensure the userData directory exists. fs.writeFile does not create parent directories.
    await fs.mkdir(userDataPath, { recursive: true });
    console.log(`[main.ts] Ensured userData directory exists: ${userDataPath}`);

    await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf-8");
    console.log(
      "[main.ts] Installer state saved successfully to:",
      stateFilePath
    );
  } catch (error: any) {
    console.error(
      `[main.ts] Error saving installer state to ${stateFilePath}:`,
      error
    );
    mainWindow?.webContents.send("installer-state-save-error", {
      message: `Failed to save installer state: ${error.message}`, // Send a more specific message
    });
  }
}
// --- END Installer State Management ---

// Initialize application lifecycle management (this will call createWindow)
// Modification needed here or in initializeAppLifecycle to check state
// and decide which UI to show (setup wizard or control panel)
initializeAppLifecycle();

// Register all IPC handlers
console.log("[main.ts] Registering IPC handlers...");
registerFileSystemIpcHandlers();
registerDialogIpcHandlers();
registerInstallerIpcHandlers();
registerEnvIpcHandlers();
registerDockerIpcHandlers();
console.log("[main.ts] IPC handlers registered");

// This should be your actual main application window
let mainWindow: BrowserWindow | null = null;

// Call this function when your main window is created and ready
export function setMainWindow(win: BrowserWindow) {
  console.log("[main.ts] setMainWindow called with window ID:", win.id);
  mainWindow = win;

  // After window is set, check installer state and inform renderer
  getInstallerState()
    .then((state) => {
      mainWindow?.webContents.send("installer-state-loaded", state);
    })
    .catch((err) => {
      console.error("[main.ts] Error sending initial state to renderer:", err);
      // Fallback or error display in renderer
      mainWindow?.webContents.send("installer-state-loaded", {
        setupComplete: false,
        setupPath: null,
        error: true,
      });
    });
}

// --- BEGIN New IPC Handlers for Setup ---
ipcMain.handle("get-installer-state", async () => {
  console.log('[main.ts] IPC event "get-installer-state" received.');
  return await getInstallerState();
});

ipcMain.handle(
  "mark-setup-complete",
  async (event, manualSetupDirectory?: string) => {
    console.log('[main.ts] IPC event "mark-setup-complete" received.');
    let pathForState: string | null = null;

    if (manualSetupDirectory && typeof manualSetupDirectory === "string") {
      console.log(
        `[main.ts] Manual setup mode: using provided path: ${manualSetupDirectory}`
      );
      // Validate the manualSetupDirectory
      try {
        await fs.access(path.join(manualSetupDirectory, "docker-compose.yml"));
        console.log(
          `[main.ts] docker-compose.yml found in manual path: ${manualSetupDirectory}`
        );
        pathForState = manualSetupDirectory;
      } catch (e) {
        console.error(
          `[main.ts] Validation Error: docker-compose.yml NOT found in manual path: ${manualSetupDirectory}.`
        );
        return {
          success: false,
          message: `Invalid manual setup directory: docker-compose.yml not found in ${manualSetupDirectory}.`,
          finalSetupPath: null,
        };
      }
    } else {
      console.log(
        "[main.ts] Non-manual mode or no path provided to mark-setup-complete: attempting to preserve existing path."
      );
      const currentState = await getInstallerState();
      pathForState = currentState.setupPath;
      if (pathForState) {
        console.log(`[main.ts] Preserving existing setupPath: ${pathForState}`);
      } else {
        console.log("[main.ts] No existing setupPath found to preserve.");
      }
    }

    try {
      await saveInstallerState(pathForState);
      console.log(
        `[main.ts] Installer state saved with setupPath: ${pathForState}`
      );
      return { success: true, finalSetupPath: pathForState };
    } catch (error: any) {
      console.error(
        "[main.ts] Error in mark-setup-complete handler during saveInstallerState:",
        error
      );
      return {
        success: false,
        message:
          error.message ||
          "Failed to save installer state after attempting to mark setup complete.",
        finalSetupPath: pathForState, // Return the path we attempted to save
      };
    }
  }
);

ipcMain.handle("run-initial-setup", async (event, allowedDirsValue: string) => {
  console.log("*********************************************************");
  console.log("*** [main.ts] run-initial-setup HANDLER ENTERED! ***");
  console.log("*********************************************************");
  console.log(
    '[main.ts] IPC event "run-initial-setup" received with allowedDirsValue:',
    allowedDirsValue
  );
  if (!mainWindow) {
    console.error("[main.ts] Cannot run initial setup: mainWindow not set.");
    return { success: false, message: "Main window not available." };
  }

  const setupDataDir = getSetupDataDir();
  mainWindow.webContents.send("setup-progress", {
    message: "Starting setup...",
  });

  try {
    // 0. Ensure parent directory for setup data exists (app.getPath('userData') should exist by default)
    // 1. Clean up old directory if it exists
    mainWindow.webContents.send("setup-progress", {
      message: `Cleaning up previous installation at ${setupDataDir} if any...`,
    });
    try {
      await fs.rm(setupDataDir, { recursive: true, force: true });
      console.log(
        `[main.ts] Successfully removed existing directory: ${setupDataDir}`
      );
    } catch (rmError: any) {
      // ENOENT is fine (directory didn't exist), other errors are problematic
      if (rmError.code !== "ENOENT") {
        console.error(
          `[main.ts] Error removing existing directory ${setupDataDir}:`,
          rmError
        );
        mainWindow.webContents.send("setup-progress", {
          message: `Error cleaning up: ${rmError.message}`,
          type: "error",
        });
        return {
          success: false,
          message: `Error cleaning up previous installation: ${rmError.message}`,
        };
      }
      console.log(
        `[main.ts] No existing directory found at ${setupDataDir}, proceeding.`
      );
    }

    await fs.mkdir(setupDataDir, { recursive: true });
    console.log(`[main.ts] Ensured setup directory exists: ${setupDataDir}`);
    mainWindow.webContents.send("setup-progress", {
      message: `Setup directory created at ${setupDataDir}`,
    });

    // 2. Clone the repository
    mainWindow.webContents.send("setup-progress", {
      message: `Cloning ${DDALAB_SETUP_REPO_URL}...`,
    });
    await new Promise<void>((resolve, reject) => {
      const cloneCommand = `git clone --depth 1 ${DDALAB_SETUP_REPO_URL} "${setupDataDir}"`;
      console.log(`[main.ts] Executing clone command: ${cloneCommand}`);
      exec(cloneCommand, (error, stdout, stderr) => {
        if (error) {
          console.error(
            `[main.ts] Error cloning repository: ${error.message}. Stderr: ${stderr}`
          );
          reject(new Error(`Git clone failed: ${stderr || error.message}`));
          return;
        }
        console.log("[main.ts] Git clone successful. Stdout:", stdout);
        resolve();
      });
    });
    mainWindow.webContents.send("setup-progress", {
      message: "Repository cloned successfully.",
    });

    // 3. Create/Update .env file
    const envFilePath = path.join(setupDataDir, ".env");
    let envContent = "";
    try {
      envContent = await fs.readFile(envFilePath, "utf-8");
      mainWindow.webContents.send("setup-progress", {
        message: `Existing .env file found. Updating DDALAB_ALLOWED_DIRS.`,
      });
    } catch (error: any) {
      if (error.code === "ENOENT") {
        mainWindow.webContents.send("setup-progress", {
          message: ".env file not found, creating new one.",
        });
      } else {
        throw error; // Re-throw other errors
      }
    }

    const allowedDirsLine = `DDALAB_ALLOWED_DIRS=${allowedDirsValue}`;
    if (envContent.includes("DDALAB_ALLOWED_DIRS=")) {
      envContent = envContent.replace(
        /^DDALAB_ALLOWED_DIRS=.*$/m,
        allowedDirsLine
      );
    } else {
      envContent += `\n${allowedDirsLine}`;
    }
    await fs.writeFile(envFilePath, envContent.trim(), "utf-8");
    mainWindow.webContents.send("setup-progress", {
      message: ".env file configured.",
    });
    console.log(
      `[main.ts] .env file configured at ${envFilePath} with DDALAB_ALLOWED_DIRS.`
    );

    // 4. Create acme.json and set permissions
    const acmeJsonPath = path.join(setupDataDir, "acme.json");
    await fs.writeFile(acmeJsonPath, "{}", "utf-8"); // Create empty JSON file
    console.log(`[main.ts] acme.json created at ${acmeJsonPath}`);

    // Set permissions for acme.json (chmod 600)
    // Note: fs.chmod might have limitations on Windows or if Node doesn't have perms.
    // Consider if this step is strictly necessary for local dev setup via installer.
    // For production, this is important.
    try {
      await fs.chmod(acmeJsonPath, 0o600); // 0o600 is octal for rw-------
      mainWindow.webContents.send("setup-progress", {
        message: "acme.json permissions set (600).",
      });
      console.log(`[main.ts] Permissions for acme.json set to 600.`);
    } catch (chmodError: any) {
      console.warn(
        `[main.ts] Could not set permissions for acme.json: ${chmodError.message}. This might be an issue on Windows or due to system permissions. Continuing...`
      );
      mainWindow.webContents.send("setup-progress", {
        message: `Warning: Could not set acme.json permissions: ${chmodError.message}. Setup will continue.`,
        type: "warning",
      });
    }

    // 5. Save installer state
    await saveInstallerState(setupDataDir);
    mainWindow.webContents.send("setup-progress", {
      message:
        "Setup complete! Application will now prepare the main interface.",
      type: "success",
    });

    // Notify renderer that setup is complete and provide the new state
    mainWindow.webContents.send("setup-finished", await getInstallerState());

    console.log("[main.ts] Initial setup successful.");
    return {
      success: true,
      message: "Setup completed successfully.",
      setupPath: setupDataDir,
    };
  } catch (error: any) {
    console.error("[main.ts] Error during initial setup:", error);
    mainWindow.webContents.send("setup-progress", {
      message: `Setup failed: ${error.message}`,
      type: "error",
    });
    // Attempt to clean up partial setup
    try {
      await fs.rm(setupDataDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(
        "[main.ts] Error cleaning up failed setup directory:",
        cleanupError
      );
    }
    return { success: false, message: `Setup failed: ${error.message}` };
  }
});

// --- END New IPC Handlers for Setup ---

// Function to get the project name (directory name of the docker-compose.yml)
// MODIFICATION NEEDED: This should use the setupPath from installer state.
async function getDockerProjectName(): Promise<string> {
  const state = await getInstallerState();
  if (!state.setupComplete || !state.setupPath) {
    // This case should ideally not be hit if called after setup or if setup is enforced.
    console.error(
      "[main.ts] Attempted to get Docker project name before setup is complete or setupPath is invalid."
    );
    // Fallback to a default or throw an error, depending on desired behavior.
    // For now, using a generic default to avoid breaking existing calls immediately, but this needs robust handling.
    const fallbackComposeFilePath =
      "/Users/simon/Desktop/DDALAB/docker-compose.yml"; // Original hardcoded path
    return path
      .basename(path.dirname(fallbackComposeFilePath))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  // Docker Compose typically uses the directory name of the compose file as the project name by default.
  return path
    .basename(state.setupPath)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// MODIFICATION NEEDED: This should use the setupPath from installer state for CWD and compose file path.
async function getTraefikContainerId(
  projectName: string
): Promise<string | null> {
  const state = await getInstallerState();
  if (!state.setupComplete || !state.setupPath) {
    console.error(
      "[main.ts] getTraefikContainerId called before setup or without valid path."
    );
    if (mainWindow) {
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message:
          "Cannot get Traefik ID: Setup not complete or path is missing.",
      });
    }
    return null;
  }
  const composeFilePath = path.join(state.setupPath, "docker-compose.yml");
  const command = `docker compose -f "${composeFilePath}" -p ${projectName} ps -q traefik`;
  console.log(`[main.ts] Executing command to get Traefik ID: ${command}`);

  return new Promise((resolve) => {
    exec(
      command,
      { cwd: state.setupPath! }, // Use setupPath as CWD
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `[main.ts] Error executing 'docker compose ps' for Traefik ID: ${error.message}. Stderr: ${stderr}. Command: ${command}`
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

// MODIFICATION NEEDED: Ensure checkTraefikHealth is called correctly if Traefik is part of the new setup.
// The containerId will come from the new getTraefikContainerId.
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

  // Fetch the entire State object as JSON
  const command = `docker inspect --format='{{json .State}}' ${containerId}`;

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
      const stateOutput = stdout.trim();
      console.log(
        `[main.ts] Raw Traefik state output for ${containerId}: '${stateOutput}'`
      );
      // Handle potentially empty output before parsing
      if (!stateOutput) {
        console.warn(
          `[main.ts] Empty state output for ${containerId}. Retrying...`
        );
        if (attempt < maxAttempts) {
          setTimeout(
            () => checkTraefikHealth(containerId, attempt + 1),
            retryDelay
          );
        } else {
          console.error(
            `[main.ts] Max attempts reached. Empty state output for ${containerId}.`
          );
          if (mainWindow) {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Traefik (${containerId}) health check failed: Empty state output after max retries.`,
            });
          }
        }
        return;
      }

      const state = JSON.parse(stateOutput);
      // Safely access the health status
      const status = state?.Health?.Status;
      console.log(
        `[main.ts] Parsed Traefik (${containerId}) state: ${JSON.stringify(
          state
        )}` // Log the whole state for debugging
      );
      console.log(
        `[main.ts] Traefik (${containerId}) health status: ${status} (type: ${typeof status}), Docker state: ${
          state.Status
        }`
      );

      // If health status is 'healthy', or if no health status is available but Docker state is 'running'
      if (
        status === "healthy" ||
        (status === undefined && state.Status === "running")
      ) {
        console.log(
          `[main.ts] Traefik (${containerId}) is considered operational (Health: ${status}, State: ${state.Status}). All services should be ready.`
        );
        if (mainWindow) {
          // Consider renaming "all-services-ready" if it implies the old setup.
          // Or ensure this event is generic enough.
          mainWindow.webContents.send("ddalab-services-ready"); // Potentially a new event name
        }
      } else {
        if (attempt < maxAttempts) {
          // Log the reason for retry more accurately
          let retryReason = `status is '${
            status || state?.Status || "unknown"
          }'`;
          if (status === "unhealthy") {
            retryReason = "reported unhealthy";
          }
          console.log(
            `[main.ts] Traefik (${containerId}) not healthy (${retryReason}). Retrying...`
          );
          setTimeout(
            () => checkTraefikHealth(containerId, attempt + 1),
            retryDelay
          );
        } else {
          console.error(
            `[main.ts] Max attempts reached. Traefik (${containerId}) not healthy (last state: ${JSON.stringify(
              state
            )}).`
          );
          if (mainWindow) {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Traefik (${containerId}) did not become healthy in time (last status: ${
                status || state?.Status || "unknown"
              }).`,
            });
          }
        }
      }
    } catch (parseError: any) {
      console.error(
        `[main.ts] Error parsing Traefik state for ${containerId} (raw: '${stdout.trim()}'): ${parseError}` // Updated log message
      );
      if (attempt < maxAttempts) {
        setTimeout(
          () => checkTraefikHealth(containerId, attempt + 1),
          retryDelay
        );
      } else {
        if (mainWindow) {
          // Ensure mainWindow check before sending message
          mainWindow.webContents.send("docker-status-update", {
            type: "error",
            message: `Error parsing Traefik health: ${parseError.message}. Max retries reached.`,
          });
        }
      }
    }
  });
}

// MODIFICATION NEEDED: This must use the setupPath for CWD and compose file path.
ipcMain.handle("start-docker-compose", async () => {
  console.log('[main.ts] IPC event "start-docker-compose" received.');
  if (!mainWindow) {
    console.error("[main.ts] Cannot start Docker Compose: mainWindow not set.");
    return false;
  }

  const state = await getInstallerState();
  if (!state.setupComplete || !state.setupPath) {
    console.error(
      "[main.ts] Cannot start Docker Compose: setup not complete or path missing."
    );
    mainWindow.webContents.send("docker-status-update", {
      type: "error",
      message: "Setup is not complete. Please run setup first.",
    });
    return false;
  }

  const projectName = await getDockerProjectName(); // ensure this uses the correct path now
  const composeFile = path.join(state.setupPath, "docker-compose.yml");
  const composeCommand = `docker compose -f "${composeFile}" -p "${projectName}" up -d`;

  mainWindow.webContents.send("docker-status-update", {
    type: "info",
    message: `Starting Docker services (project: ${projectName}, path: ${state.setupPath})... Command: ${composeCommand}`,
  });

  return new Promise((resolvePromise) => {
    exec(
      composeCommand,
      { cwd: state.setupPath! }, // Use setupPath as CWD
      async (error, stdout, stderr) => {
        if (!error) {
          console.log(
            `[main.ts] 'docker-compose up -d' successful. Stdout: ${stdout}`
          );
          mainWindow?.webContents.send("docker-status-update", {
            type: "success",
            message: "Docker services started. Checking Traefik health...",
          });
          const traefikContainerId = await getTraefikContainerId(projectName);
          if (traefikContainerId) {
            checkTraefikHealth(traefikContainerId);
          } else {
            console.error(
              "[main.ts] Could not get Traefik container ID after startup."
            );
            mainWindow?.webContents.send("docker-status-update", {
              type: "error",
              message:
                "Failed to get Traefik ID after startup. Services might not be accessible.",
            });
          }
          resolvePromise(true);
        } else {
          console.error(
            `[main.ts] Error starting Docker Compose: ${error.message}. Stderr: ${stderr}`
          );
          mainWindow?.webContents.send("docker-status-update", {
            type: "error",
            message: `Failed to start Docker services: ${
              stderr || error.message
            }`,
          });
          resolvePromise(false);
        }
      }
    );
  });
});

console.log("[main.ts] Registering stop-docker-compose handler");
ipcMain.handle(
  "stop-docker-compose",
  async (event, deleteVolumes?: boolean) => {
    console.log(
      '[main.ts] IPC event "stop-docker-compose" received with deleteVolumes:',
      deleteVolumes
    );
    if (!mainWindow) {
      console.error(
        "[main.ts] Cannot stop Docker Compose: mainWindow not set."
      );
      return false;
    }

    const state = await getInstallerState();
    if (!state.setupComplete || !state.setupPath) {
      console.error(
        "[main.ts] Cannot stop Docker Compose: setup not complete or path missing."
      );
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: "Setup is not complete. Cannot stop services.",
      });
      return false;
    }

    const projectName = await getDockerProjectName();
    const composeFile = path.join(state.setupPath, "docker-compose.yml");
    let composeCommand = `docker compose -f "${composeFile}" -p "${projectName}" down`;

    if (deleteVolumes) {
      composeCommand += " --volumes";
    }

    mainWindow.webContents.send("docker-status-update", {
      type: "info",
      message: `Stopping Docker services (project: ${projectName}, path: ${state.setupPath})...`,
    });

    return new Promise((resolvePromise) => {
      exec(
        composeCommand,
        { cwd: state.setupPath! }, // Use setupPath as CWD
        (error, stdout, stderr) => {
          if (error) {
            console.error(
              `[main.ts] Error stopping Docker Compose: ${error.message}. Stderr: ${stderr}`
            );
            mainWindow?.webContents.send("docker-status-update", {
              type: "error",
              message: `Failed to stop Docker services: ${
                stderr || error.message
              }`,
            });
            resolvePromise(false);
          } else {
            console.log(
              `[main.ts] 'docker compose down' successful. Stdout: ${stdout}`
            );
            mainWindow?.webContents.send("docker-status-update", {
              type: "success",
              message: "Docker services stopped successfully.",
            });
            resolvePromise(true);
          }
        }
      );
    });
  }
);

// Docker status handler - check if containers are actually running
ipcMain.handle("get-docker-status", async () => {
  console.log('[main.ts] IPC event "get-docker-status" received.');

  try {
    const state = await getInstallerState();
    if (!state.setupComplete || !state.setupPath) {
      console.log("[main.ts] Docker status: Setup not complete or no path");
      return false;
    }

    const projectName = await getDockerProjectName();
    const composeFile = path.join(state.setupPath, "docker-compose.yml");
    const command = `docker compose -f "${composeFile}" -p "${projectName}" ps --services --filter status=running`;

    console.log(`[main.ts] Checking Docker status with command: ${command}`);

    const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        exec(command, { cwd: state.setupPath! }, (error, stdout, stderr) => {
          if (error) {
            console.log(
              `[main.ts] Docker status check error (likely no containers): ${error.message}`
            );
            resolve({ stdout: "", stderr });
          } else {
            resolve({ stdout, stderr });
          }
        });
      }
    );

    const isRunning = stdout.trim().length > 0;
    console.log(
      `[main.ts] Docker status result: ${isRunning} (output: "${stdout.trim()}")`
    );
    return isRunning;
  } catch (error) {
    console.error("[main.ts] Error checking Docker status:", error);
    return false;
  }
});
