import { app } from "electron";
import { exec } from "child_process";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";

const DDALAB_SETUP_REPO_URL = "https://github.com/sdraeger/DDALAB-setup.git";
const DDALAB_SETUP_DIR_NAME = "ddalab-setup-data";
const INSTALLER_STATE_FILE_NAME = "installer-state.json";

export interface InstallerState {
  setupComplete: boolean;
  setupPath: string | null;
  dataLocation?: string;
  cloneLocation?: string;
}

export interface SetupResult {
  success: boolean;
  message: string;
  setupPath?: string;
  needsClone?: boolean;
  targetPath?: string;
}

export class SetupService {
  static getSetupDataDir(): string {
    return path.join(app.getPath("userData"), DDALAB_SETUP_DIR_NAME);
  }

  static getInstallerStateFilePath(): string {
    return path.join(app.getPath("userData"), INSTALLER_STATE_FILE_NAME);
  }

  static async getInstallerState(): Promise<InstallerState> {
    const stateFilePath = this.getInstallerStateFilePath();
    logger.info(`Reading installer state from: ${stateFilePath}`);
    try {
      const data = await fs.readFile(stateFilePath, "utf-8");
      const state = JSON.parse(data);
      if (
        typeof state.setupComplete === "boolean" &&
        (state.setupPath === null || typeof state.setupPath === "string")
      ) {
        logger.info(`Successfully parsed installer state:`, state);
        return state;
      }
      logger.warn(
        `Installer state file format is invalid. Resetting. State was:`,
        state
      );
      return { setupComplete: false, setupPath: null };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        logger.info(
          `Installer state file not found at ${stateFilePath}. Assuming first run.`
        );
      } else {
        logger.error(
          `Error reading installer state file ${stateFilePath}:`,
          error
        );
      }
      return { setupComplete: false, setupPath: null };
    }
  }

  static async saveInstallerState(
    setupPathOrDataLocation: string | null,
    cloneLocation?: string
  ): Promise<void> {
    const stateFilePath = this.getInstallerStateFilePath();

    let state: InstallerState;
    if (cloneLocation !== undefined) {
      // New format with separate locations
      state = {
        setupComplete: true,
        setupPath: cloneLocation, // For backward compatibility, use cloneLocation as setupPath
        dataLocation: setupPathOrDataLocation || undefined,
        cloneLocation: cloneLocation,
      };
    } else {
      // Legacy format
      state = {
        setupComplete: true,
        setupPath: setupPathOrDataLocation,
      };
    }

    try {
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      await fs.writeFile(
        stateFilePath,
        JSON.stringify(state, null, 2),
        "utf-8"
      );
      logger.info(`Installer state saved successfully to: ${stateFilePath}`);
    } catch (error: any) {
      logger.error(`Error saving installer state to ${stateFilePath}:`, error);
      getMainWindow()?.webContents.send("installer-state-save-error", {
        message: `Failed to save installer state: ${error.message}`,
      });
    }
  }

  static async cloneRepository(
    targetDir: string,
    allowedDirsValue: string
  ): Promise<SetupResult> {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { success: false, message: "Main window not available." };
    }

    try {
      // Check if directory is empty or only contains .env
      let directoryContents: string[] = [];
      try {
        directoryContents = (await fs.readdir(targetDir)).filter(
          (file) =>
            !file.startsWith(".") &&
            !["node_modules", "dist", "build"].includes(file)
        );
      } catch (error: any) {
        if (error.code === "ENOENT") {
          await fs.mkdir(targetDir, { recursive: true });
          logger.info(`Created target directory: ${targetDir}`);
        } else {
          throw error;
        }
      }

      if (directoryContents.length > 0) {
        logger.warn(
          `Target directory ${targetDir} is not empty. Contents:`,
          directoryContents
        );
        return {
          success: false,
          message:
            "Target directory is not empty. Please select an empty directory or remove existing files.",
        };
      }

      mainWindow.webContents.send("setup-progress", {
        message: `Cloning ${DDALAB_SETUP_REPO_URL} into ${targetDir}...`,
      });
      await new Promise<void>((resolve, reject) => {
        const cloneCommand = `git clone --depth 1 ${DDALAB_SETUP_REPO_URL} "${targetDir}"`;
        logger.info(`Executing clone command: ${cloneCommand}`);
        exec(cloneCommand, (error, stdout, stderr) => {
          if (error) {
            logger.error(
              `Error cloning repository: ${error.message}. Stderr: ${stderr}`
            );
            reject(new Error(`Git clone failed: ${stderr || error.message}`));
            return;
          }
          logger.info(`Git clone successful. Stdout: ${stdout}`);
          resolve();
        });
      });
      mainWindow.webContents.send("setup-progress", {
        message: "Repository cloned successfully.",
      });

      // Configure .env file
      const envFilePath = path.join(targetDir, ".env");
      let envContent = "";
      try {
        envContent = await fs.readFile(envFilePath, "utf-8");
        mainWindow.webContents.send("setup-progress", {
          message: "Existing .env file found. Updating DDALAB_ALLOWED_DIRS.",
        });
      } catch (error: any) {
        if (error.code === "ENOENT") {
          mainWindow.webContents.send("setup-progress", {
            message: ".env file not found, creating new one.",
          });
        } else {
          throw error;
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
      logger.info(
        `.env file configured at ${envFilePath} with DDALAB_ALLOWED_DIRS.`
      );

      // Create acme.json
      const acmeJsonPath = path.join(targetDir, "acme.json");
      await fs.writeFile(acmeJsonPath, "{}", "utf-8");
      logger.info(`acme.json created at ${acmeJsonPath}`);

      try {
        await fs.chmod(acmeJsonPath, 0o600);
        mainWindow.webContents.send("setup-progress", {
          message: "acme.json permissions set (600).",
        });
        logger.info(`Permissions for acme.json set to 600.`);
      } catch (chmodError: any) {
        logger.warn(
          `Could not set permissions for acme.json: ${chmodError.message}`
        );
        mainWindow.webContents.send("setup-progress", {
          message: `Warning: Could not set acme.json permissions: ${chmodError.message}`,
          type: "warning",
        });
      }

      return {
        success: true,
        message: "Repository cloned and configured successfully.",
        setupPath: targetDir,
      };
    } catch (error: any) {
      logger.error(`Error during repository cloning: ${error.message}`);
      mainWindow.webContents.send("setup-progress", {
        message: `Repository cloning failed: ${error.message}`,
        type: "error",
      });
      try {
        await fs.rm(targetDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.error(`Error cleaning up failed clone directory:`, cleanupError);
      }
      return {
        success: false,
        message: `Repository cloning failed: ${error.message}`,
      };
    }
  }
}
