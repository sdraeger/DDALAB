import { app } from "electron";
import { exec } from "child_process";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";

const DDALAB_SETUP_REPO_URL = "https://github.com/sdraeger/DDALAB-setup.git";
const DDALAB_SETUP_DIR_NAME = "ddalab-setup-data";
const CONFIG_MANAGER_STATE_FILE_NAME = "configmanager-state.json";

export interface ConfigManagerState {
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

export interface UserConfiguration {
  dataLocation: string;
  allowedDirs: string;
  webPort?: string;
  apiPort?: string;
  dbPassword?: string;
  minioPassword?: string;
  traefikEmail?: string;
  useDockerHub?: boolean;
}

export class SetupService {
  static getSetupDataDir(): string {
    return path.join(app.getPath("userData"), DDALAB_SETUP_DIR_NAME);
  }

  static getConfigManagerStateFilePath(): string {
    return path.join(app.getPath("userData"), CONFIG_MANAGER_STATE_FILE_NAME);
  }

  static async getConfigManagerState(): Promise<ConfigManagerState> {
    const stateFilePath = this.getConfigManagerStateFilePath();
    logger.info(`Reading configmanager state from: ${stateFilePath}`);
    try {
      const data = await fs.readFile(stateFilePath, "utf-8");
      const state = JSON.parse(data);
      if (
        typeof state.setupComplete === "boolean" &&
        (state.setupPath === null || typeof state.setupPath === "string")
      ) {
        logger.info(`Successfully parsed configmanager state:`, state);
        return state;
      }
      logger.warn(
        `ConfigManager state file format is invalid. Resetting. State was:`,
        state
      );
      return { setupComplete: false, setupPath: null };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        logger.info(
          `ConfigManager state file not found at ${stateFilePath}. Assuming first run.`
        );
      } else {
        logger.error(
          `Error reading configmanager state file ${stateFilePath}:`,
          error
        );
      }
      return { setupComplete: false, setupPath: null };
    }
  }

  static async saveConfigManagerState(
    setupPathOrDataLocation: string | null,
    cloneLocation?: string
  ): Promise<void> {
    const stateFilePath = this.getConfigManagerStateFilePath();

    let state: ConfigManagerState;
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
      logger.info(
        `ConfigManager state saved successfully to: ${stateFilePath}`
      );
    } catch (error: any) {
      logger.error(
        `Error saving configmanager state to ${stateFilePath}:`,
        error
      );
      getMainWindow()?.webContents.send("configmanager-state-save-error", {
        message: `Failed to save configmanager state: ${error.message}`,
      });
    }
  }

  /**
   * Enhanced setup method that combines repository cloning with programmatic configuration
   */
  static async setupDDALAB(
    targetDir: string,
    userConfig: UserConfiguration
  ): Promise<SetupResult> {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { success: false, message: "Main window not available." };
    }

    try {
      mainWindow.webContents.send("setup-progress", {
        message: "Starting DDALAB setup...",
      });

      // Step 1: Clone the setup repository
      const cloneResult = await this.cloneRepository(
        targetDir,
        userConfig.allowedDirs
      );
      if (!cloneResult.success) {
        return cloneResult;
      }

      // Step 2: Generate user-specific configurations
      await this.generateUserConfigurations(targetDir, userConfig);

      // Step 3: Create required directories
      await this.createRequiredDirectories(targetDir, userConfig);

      // Step 4: Setup security files
      await this.setupSecurityFiles(targetDir);

      // Step 5: Validate the complete setup
      await this.validateCompleteSetup(targetDir);

      mainWindow.webContents.send("setup-progress", {
        message: "DDALAB setup completed successfully!",
        type: "success",
      });

      return {
        success: true,
        message: "DDALAB setup completed successfully.",
        setupPath: targetDir,
      };
    } catch (error: any) {
      logger.error(`Error during DDALAB setup: ${error.message}`);
      mainWindow.webContents.send("setup-progress", {
        message: `Setup failed: ${error.message}`,
        type: "error",
      });
      return {
        success: false,
        message: `Setup failed: ${error.message}`,
      };
    }
  }

  /**
   * Generate user-specific configuration files
   */
  static async generateUserConfigurations(
    targetDir: string,
    userConfig: UserConfiguration
  ): Promise<void> {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    mainWindow.webContents.send("setup-progress", {
      message: "Generating user-specific configurations...",
    });

    // Generate enhanced .env file
    await this.generateEnvFile(targetDir, userConfig);

    // Generate docker-compose.volumes.yml
    await this.generateVolumeConfig(targetDir, userConfig);

    // Update docker-compose.yml if needed
    await this.updateDockerCompose(targetDir, userConfig);

    mainWindow.webContents.send("setup-progress", {
      message: "Configuration files generated successfully.",
    });
  }

  /**
   * Generate enhanced .env file with user configuration
   */
  static async generateEnvFile(
    targetDir: string,
    userConfig: UserConfiguration
  ): Promise<void> {
    const envFilePath = path.join(targetDir, ".env");
    let envContent = "";

    try {
      // Try to read existing .env file from setup repository
      envContent = await fs.readFile(envFilePath, "utf-8");
    } catch (error: any) {
      if (error.code === "ENOENT") {
        // Create new .env file with comprehensive configuration
        envContent = this.generateDefaultEnvContent(userConfig);
      } else {
        throw error;
      }
    }

    // Update with user-specific values
    envContent = this.updateEnvContent(envContent, userConfig);
    await fs.writeFile(envFilePath, envContent.trim(), "utf-8");
  }

  /**
   * Generate default .env content
   */
  static generateDefaultEnvContent(userConfig: UserConfiguration): string {
    return `# DDALAB Docker Deployment Configuration
# Generated by ConfigManager

# Use Docker Hub images
DDALAB_WEB_IMAGE=sdraeger1/ddalab-web:latest
DDALAB_API_IMAGE=sdraeger1/ddalab-api:latest

# Database Configuration
DDALAB_DB_USER=ddalab
DDALAB_DB_PASSWORD=${userConfig.dbPassword || "ddalab_password"}
DDALAB_DB_NAME=ddalab
DDALAB_DB_HOST=postgres
DDALAB_DB_PORT=5432

# MinIO Configuration
MINIO_ROOT_USER=ddalab
MINIO_ROOT_PASSWORD=${userConfig.minioPassword || "ddalab_password"}
MINIO_HOST=minio:9000
MINIO_ACCESS_KEY=ddalab
MINIO_SECRET_KEY=${userConfig.minioPassword || "ddalab_password"}

# Redis Configuration
DDALAB_REDIS_HOST=redis
DDALAB_REDIS_PORT=6379
DDALAB_REDIS_DB=0
DDALAB_REDIS_PASSWORD=
DDALAB_REDIS_USE_SSL=False
DDALAB_PLOT_CACHE_TTL=3600

# Web Application Configuration
WEB_PORT=${userConfig.webPort || "3000"}
NEXT_PUBLIC_API_URL=http://localhost:${userConfig.apiPort || "8001"}
NEXT_PUBLIC_APP_URL=http://localhost:${userConfig.webPort || "3000"}
SESSION_EXPIRATION=10080

# API Configuration
DDALAB_API_HOST=0.0.0.0
DDALAB_API_PORT=${userConfig.apiPort || "8001"}
DDALAB_RELOAD=False
DDALAB_INSTITUTION_NAME=DDALAB
DDALAB_DATA_DIR=./data

# Authentication Configuration
DDALAB_JWT_SECRET_KEY=ddalab-auth-secret-key-${
      new Date().toISOString().split("T")[0]
    }
DDALAB_JWT_ALGORITHM=HS256
DDALAB_TOKEN_EXPIRATION_MINUTES=60
DDALAB_AUTH_MODE=multi-user

# Traefik Configuration
TRAEFIK_ACME_EMAIL=${userConfig.traefikEmail || "admin@ddalab.local"}
TRAEFIK_PASSWORD_HASH=

# Allowed Directories for API access
DDALAB_ALLOWED_DIRS=${userConfig.allowedDirs}

# Analysis Configuration
DDALAB_MAX_CONCURRENT_TASKS=5
DDALAB_TASK_TIMEOUT=300
DDALAB_DDA_BINARY_PATH=/app/server/bin/run_DDA_ASCII

# SSL Configuration
DDALAB_SSL_ENABLED=False

# Version
VERSION=latest
`;
  }

  /**
   * Update existing .env content with user configuration
   */
  static updateEnvContent(
    envContent: string,
    userConfig: UserConfiguration
  ): string {
    const updates = {
      DDALAB_ALLOWED_DIRS: userConfig.allowedDirs,
      WEB_PORT: userConfig.webPort || "3000",
      DDALAB_API_PORT: userConfig.apiPort || "8001",
      DDALAB_DB_PASSWORD: userConfig.dbPassword || "ddalab_password",
      MINIO_ROOT_PASSWORD: userConfig.minioPassword || "ddalab_password",
      TRAEFIK_ACME_EMAIL: userConfig.traefikEmail || "admin@ddalab.local",
    };

    let updatedContent = envContent;

    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (updatedContent.match(regex)) {
        updatedContent = updatedContent.replace(regex, `${key}=${value}`);
      } else {
        updatedContent += `\n${key}=${value}`;
      }
    }

    return updatedContent;
  }

  /**
   * Generate docker-compose.volumes.yml based on allowed directories
   */
  static async generateVolumeConfig(
    targetDir: string,
    userConfig: UserConfiguration
  ): Promise<void> {
    const volumesContent = `# Auto-generated volume configuration
# Generated from DDALAB_ALLOWED_DIRS: ${userConfig.allowedDirs}

services:
  api:
    volumes:
      - prometheus_metrics:/tmp/prometheus
`;

    const volumesFilePath = path.join(targetDir, "docker-compose.volumes.yml");
    await fs.writeFile(volumesFilePath, volumesContent, "utf-8");
  }

  /**
   * Update docker-compose.yml if needed for user configuration
   */
  static async updateDockerCompose(
    targetDir: string,
    userConfig: UserConfiguration
  ): Promise<void> {
    const composePath = path.join(targetDir, "docker-compose.yml");

    try {
      let composeContent = await fs.readFile(composePath, "utf-8");

      // Update image references if using Docker Hub
      if (userConfig.useDockerHub) {
        composeContent = composeContent.replace(
          /image: \${DDALAB_WEB_IMAGE:-[^}]+}/g,
          "image: ${DDALAB_WEB_IMAGE:-sdraeger1/ddalab-web:${VERSION:-latest}}"
        );
        composeContent = composeContent.replace(
          /image: \${DDALAB_API_IMAGE:-[^}]+}/g,
          "image: ${DDALAB_API_IMAGE:-sdraeger1/ddalab-api:${VERSION:-latest}}"
        );
      }

      await fs.writeFile(composePath, composeContent, "utf-8");
    } catch (error) {
      logger.warn(`Could not update docker-compose.yml: ${error}`);
    }
  }

  /**
   * Create required directories for DDALAB setup
   */
  static async createRequiredDirectories(
    targetDir: string,
    userConfig: UserConfiguration
  ): Promise<void> {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    const directories = ["data", "dynamic", "certs", "traefik-logs", "scripts"];

    mainWindow.webContents.send("setup-progress", {
      message: "Creating required directories...",
    });

    for (const dir of directories) {
      const dirPath = path.join(targetDir, dir);
      await fs.mkdir(dirPath, { recursive: true });
    }

    // Create data directory at user's specified location
    if (
      userConfig.dataLocation &&
      userConfig.dataLocation !== path.join(targetDir, "data")
    ) {
      await fs.mkdir(userConfig.dataLocation, { recursive: true });
    }

    mainWindow.webContents.send("setup-progress", {
      message: "Directories created successfully.",
    });
  }

  /**
   * Setup security files (acme.json, certificates)
   */
  static async setupSecurityFiles(targetDir: string): Promise<void> {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    mainWindow.webContents.send("setup-progress", {
      message: "Setting up security files...",
    });

    // Create acme.json
    const acmeJsonPath = path.join(targetDir, "acme.json");
    await fs.writeFile(acmeJsonPath, "{}", "utf-8");

    try {
      await fs.chmod(acmeJsonPath, 0o600);
    } catch (error: any) {
      logger.warn(`Could not set acme.json permissions: ${error.message}`);
    }

    mainWindow.webContents.send("setup-progress", {
      message: "Security files configured.",
    });
  }

  /**
   * Validate the complete setup
   */
  static async validateCompleteSetup(targetDir: string): Promise<void> {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    mainWindow.webContents.send("setup-progress", {
      message: "Validating setup...",
    });

    const requiredFiles = [
      "docker-compose.yml",
      ".env",
      "traefik.yml",
      "prometheus.yml",
      "acme.json",
    ];

    const requiredDirs = ["data", "dynamic", "certs"];

    for (const file of requiredFiles) {
      const filePath = path.join(targetDir, file);
      await fs.access(filePath);
    }

    for (const dir of requiredDirs) {
      const dirPath = path.join(targetDir, dir);
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        throw new Error(`${dir} exists but is not a directory`);
      }
    }

    mainWindow.webContents.send("setup-progress", {
      message: "Setup validation completed successfully.",
    });
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

      return {
        success: true,
        message: "Repository cloned successfully.",
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
