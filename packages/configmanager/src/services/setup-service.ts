import { app } from "electron";
import { exec } from "child_process";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";
import { EnvGeneratorService } from "./env-generator-service";
import type { UserSelections, ParsedEnvEntry } from "../utils/electron";

const DDALAB_SETUP_REPO_URL = "https://github.com/sdraeger/DDALAB-setup.git";
const DDALAB_SETUP_DIR_NAME = "ddalab-setup-data";
const CONFIG_MANAGER_STATE_FILE_NAME = "configmanager-state.json";

// Debug mode: use local DDALAB directory instead of cloning
const DEBUG_MODE = process.env.DDALAB_DEBUG_LOCAL === "true";
const LOCAL_DDALAB_PATH =
  process.env.DDALAB_LOCAL_PATH || "/Users/simon/Desktop/DDALAB";

export interface ConfigManagerState {
  setupComplete: boolean;
  setupPath: string | null;
  dataLocation?: string;
  cloneLocation?: string;
  // Enhanced state persistence
  userSelections?: UserSelections;
  currentSite?: string;
  parsedEnvEntries?: ParsedEnvEntry[];
  installationSuccess?: boolean | null;
  lastUpdated?: number;
  version?: string;
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
  apiPortMetrics?: string;
  dbPassword?: string;
  minioPassword?: string;
  traefikEmail?: string;
  useDockerHub?: boolean;
  authMode?: string;
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

      // Validate basic required fields
      if (
        typeof state.setupComplete === "boolean" &&
        (state.setupPath === null || typeof state.setupPath === "string")
      ) {
        // Migrate old state format if needed
        const migratedState = this.migrateStateIfNeeded(state);
        logger.info(`Successfully parsed configmanager state:`, migratedState);
        return migratedState;
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

  /**
   * Migrate state format between versions
   */
  private static migrateStateIfNeeded(state: any): ConfigManagerState {
    const currentVersion = "2.0.0"; // Increment when state format changes

    // If no version, it's an old format
    if (!state.version) {
      logger.info("Migrating from legacy state format");
      return {
        ...state,
        version: currentVersion,
        lastUpdated: Date.now(),
        userSelections: state.userSelections || {
          setupType: "",
          dataLocation: "",
          cloneLocation: "",
          envVariables: {},
        },
        currentSite: state.currentSite || "welcome",
        parsedEnvEntries: state.parsedEnvEntries || [],
        installationSuccess: state.installationSuccess || null,
      };
    }

    // If version is current, return as-is
    if (state.version === currentVersion) {
      return state;
    }

    // Handle future migrations here
    logger.info(
      `Migrating state from version ${state.version} to ${currentVersion}`
    );
    return {
      ...state,
      version: currentVersion,
      lastUpdated: Date.now(),
    };
  }

  static async saveConfigManagerState(
    setupPathOrDataLocation: string | null,
    cloneLocation?: string,
    additionalState?: Partial<ConfigManagerState>
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
        version: "2.0.0",
        lastUpdated: Date.now(),
        ...additionalState,
      };
    } else {
      // Legacy format
      state = {
        setupComplete: true,
        setupPath: setupPathOrDataLocation,
        version: "2.0.0",
        lastUpdated: Date.now(),
        ...additionalState,
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
   * Save comprehensive application state including user selections and navigation
   */
  static async saveFullApplicationState(
    setupPathOrDataLocation: string | null,
    cloneLocation: string | null,
    userSelections: UserSelections,
    currentSite: string,
    parsedEnvEntries: ParsedEnvEntry[],
    installationSuccess: boolean | null
  ): Promise<void> {
    const additionalState: Partial<ConfigManagerState> = {
      userSelections,
      currentSite,
      parsedEnvEntries,
      installationSuccess,
    };

    await this.saveConfigManagerState(
      setupPathOrDataLocation,
      cloneLocation || undefined,
      additionalState
    );
  }

  /**
   * Save only user selections and navigation state (for frequent updates)
   */
  static async saveUserState(
    userSelections: UserSelections,
    currentSite: string,
    parsedEnvEntries: ParsedEnvEntry[],
    installationSuccess: boolean | null
  ): Promise<void> {
    try {
      const existingState = await this.getConfigManagerState();
      const updatedState: ConfigManagerState = {
        ...existingState,
        userSelections,
        currentSite,
        parsedEnvEntries,
        installationSuccess,
        lastUpdated: Date.now(),
      };

      const stateFilePath = this.getConfigManagerStateFilePath();
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      await fs.writeFile(
        stateFilePath,
        JSON.stringify(updatedState, null, 2),
        "utf-8"
      );

      logger.info("User state saved successfully");
    } catch (error: any) {
      logger.error("Error saving user state:", error);
    }
  }

  /**
   * Clear the config manager state (useful for testing isolation)
   */
  static async clearConfigManagerState(): Promise<void> {
    const stateFilePath = this.getConfigManagerStateFilePath();
    try {
      await fs.unlink(stateFilePath);
      logger.info(`ConfigManager state cleared from: ${stateFilePath}`);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        logger.info(
          `ConfigManager state file not found at ${stateFilePath}. Nothing to clear.`
        );
      } else {
        logger.error(
          `Error clearing configmanager state from ${stateFilePath}:`,
          error
        );
      }
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
        userConfig.allowedDirs,
        userConfig
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

      // Save the configmanager state to mark setup as complete
      await this.saveConfigManagerState(targetDir, targetDir);
      logger.info(`ConfigManager state saved for setup path: ${targetDir}`);

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

    // Generate consolidated container environment file (.env)
    const envFilePath = path.join(targetDir, ".env");
    await EnvGeneratorService.generateContainerEnvFiles(targetDir, envFilePath);

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
DDALAB_USE_DOCKER_HUB=true
DDALAB_IMAGE=sdraeger1/ddalab-monolith:latest

# Database Configuration
DDALAB_DB_USER=admin
DDALAB_DB_PASSWORD=${userConfig.dbPassword || "AdminPassword123"}
DDALAB_DB_NAME=postgres
DDALAB_DB_HOST=postgres
DDALAB_DB_PORT=5432

# MinIO Configuration
MINIO_ROOT_USER=ddalab
MINIO_ROOT_PASSWORD=${userConfig.minioPassword || "AdminPassword123"}
MINIO_HOST=minio:9000
MINIO_ACCESS_KEY=ddalab
MINIO_SECRET_KEY=${userConfig.minioPassword || "AdminPassword123"}

# Redis Configuration
DDALAB_REDIS_HOST=redis
DDALAB_REDIS_PORT=6379
DDALAB_REDIS_DB=0
DDALAB_REDIS_PASSWORD=
DDALAB_REDIS_USE_SSL=False
DDALAB_PLOT_CACHE_TTL=3600

# Web Application Configuration (Accessible via Traefik)
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
DDALAB_AUTH_MODE=${userConfig.authMode || "multi-user"}

# Traefik Configuration
TRAEFIK_ACME_EMAIL=${userConfig.traefikEmail || "admin@ddalab.local"}
TRAEFIK_PASSWORD_HASH=

# Allowed Directories for API access
DDALAB_ALLOWED_DIRS=${userConfig.allowedDirs}

# Analysis Configuration
DDALAB_MAX_CONCURRENT_TASKS=5
DDALAB_TASK_TIMEOUT=300
DDALAB_DDA_BINARY_PATH=/app/bin/run_DDA_ASCII

# SSL Configuration
DDALAB_SSL_ENABLED=False

# Next.js Debug Configuration (enables advanced patch for filter error)
DDALAB_DEBUG_NEXTJS=true

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
      DDALAB_AUTH_MODE: userConfig.authMode || "multi-user",
      DDALAB_IMAGE: "sdraeger1/ddalab-monolith:latest",
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
    // Parse allowedDirs to create bind mounts
    const allowedDirsParts = userConfig.allowedDirs.split(":");
    let bindMounts = "";

    if (allowedDirsParts.length >= 2) {
      const sourcePath = allowedDirsParts[0];
      const targetPath = allowedDirsParts[1];
      const permissions = allowedDirsParts[2] || "rw";

      bindMounts = `      - type: bind
        source: ${sourcePath}
        target: ${targetPath}`;
    }

    const volumesContent = `# Auto-generated volume configuration for monolithic container
# Generated from DDALAB_ALLOWED_DIRS: ${userConfig.allowedDirs}

services:
  ddalab:
    volumes:
      - prometheus_data:/tmp/prometheus${bindMounts ? "\n" + bindMounts : ""}
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

      // If using Docker Hub, remove build sections to prevent local building
      if (userConfig.useDockerHub) {
        const lines = composeContent.split("\n");
        const cleanedLines = [];
        let skipNextLines = 0;
        let inBuildSection = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();

          if (skipNextLines > 0) {
            skipNextLines--;
            continue;
          }

          if (trimmed === "build:") {
            let nextLine = "";
            let nextNextLine = "";
            if (i + 1 < lines.length) nextLine = lines[i + 1].trim();
            if (i + 2 < lines.length) nextNextLine = lines[i + 2].trim();

            if (
              nextLine === "context: ." &&
              nextNextLine === "dockerfile: ./Dockerfile"
            ) {
              skipNextLines = 2;
              continue;
            }
          }

          if (trimmed === "platform: linux/amd64") {
            continue;
          }

          cleanedLines.push(line);
        }

        composeContent = cleanedLines.join("\n");
      }

      // Replace individual service images with the monolithic image
      composeContent = composeContent.replace(
        /image: sdraeger1\/ddalab-web:.*$/m,
        "image: sdraeger1/ddalab-monolith:${VERSION:-latest}"
      );
      composeContent = composeContent.replace(
        /image: sdraeger1\/ddalab-api:.*$/m,
        "# Removed: API service merged into monolith"
      );

      // Remove web and api service definitions and replace with a single ddalab service
      const lines = composeContent.split("\n");
      const updatedLines: string[] = [];
      let inServiceBlock = false;
      let currentService = "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        const indent = line.match(/^(\s*)/)?.[1] || "";

        if (trimmedLine.startsWith("web:") || trimmedLine.startsWith("api:")) {
          inServiceBlock = true;
          currentService = trimmedLine.replace(":", "");
          if (currentService === "web") {
            updatedLines.push("  ddalab:");
            updatedLines.push("    build:");
            updatedLines.push("      context: .");
            updatedLines.push("      dockerfile: ./Dockerfile");
            updatedLines.push("    image: ddalab-monolith:latest");
            updatedLines.push("    env_file:");
            updatedLines.push("      - ./.env");
            updatedLines.push("    ports:");
            updatedLines.push('      - "${WEB_PORT:-3000}:3000"');
            updatedLines.push('      - "${DDALAB_API_PORT:-8001}:8001"');
            updatedLines.push(
              '      - "${DDALAB_API_PORT_METRICS:-8002}:8002"'
            );
            updatedLines.push("    healthcheck:");
            updatedLines.push(
              '      test: ["CMD", "curl", "-f", "http://localhost:3000"]'
            );
            updatedLines.push("      interval: 10s");
            updatedLines.push("      timeout: 10s");
            updatedLines.push("      retries: 10");
            updatedLines.push("      start_period: 60s");
            updatedLines.push("    depends_on:");
            updatedLines.push("      postgres:");
            updatedLines.push("        condition: service_healthy");
            updatedLines.push("      minio:");
            updatedLines.push("        condition: service_started");
            updatedLines.push("      redis:");
            updatedLines.push("        condition: service_started");
            updatedLines.push("    networks:");
            updatedLines.push("      - internal");
            updatedLines.push("    labels:");
            updatedLines.push('      - "traefik.enable=true"');
            updatedLines.push("    restart: unless-stopped");
            updatedLines.push("");
          }
          continue;
        }

        if (
          inServiceBlock &&
          (trimmedLine === "" || /^[a-zA-Z]/.test(trimmedLine))
        ) {
          inServiceBlock = false;
        }

        if (!inServiceBlock) {
          updatedLines.push(line);
        }
      }
      composeContent = updatedLines.join("\n");

      await fs.writeFile(composePath, composeContent, "utf-8");
      logger.info(`Updated docker-compose.yml for monolithic usage`);
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
    allowedDirsValue: string,
    userConfig: UserConfiguration
  ): Promise<SetupResult> {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      return { success: false, message: "Main window not available." };
    }

    try {
      // Check if directory is empty or only contains .env and expected deployment files
      let directoryContents: string[] = [];
      try {
        const readResult = await fs.readdir(targetDir);
        if (readResult && Array.isArray(readResult)) {
          // Allow certain DDALAB deployment files to exist
          const allowedFiles = [
            "docker-compose.yml",
            "docker-compose.volumes.yml",
            "traefik.yml",
            "prometheus.yml",
            "acme.json",
            "package.json",
            "turbo.json",
            "README.md",
            "DOCKER_DEPLOYMENT.md",
            "ENVIRONMENT_VARIABLES.md",
            "VOLUMES.md",
            "up.sh",
            "cleanup.sh",
            ".env",
          ];
          const allowedDirs = [
            "node_modules",
            "dist",
            "build",
            "certs",
            "dynamic",
            "scripts",
            "data",
            "traefik-logs",
            "prometheus-metrics",
          ];

          directoryContents = readResult.filter(
            (file) =>
              !file.startsWith(".") &&
              !allowedFiles.includes(file) &&
              !allowedDirs.includes(file)
          );
        }
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
          `Target directory ${targetDir} contains unexpected files. Contents:`,
          directoryContents
        );
        return {
          success: false,
          message:
            "Target directory contains unexpected files. Please select an empty directory or remove non-DDALAB files.",
        };
      }

      if (DEBUG_MODE) {
        // Debug mode: build containers locally and create deployment-ready compose file
        mainWindow.webContents.send("setup-progress", {
          message: `DEBUG MODE: Building monolithic container from ${LOCAL_DDALAB_PATH}...`,
        });

        logger.info(`DEBUG MODE: Using local files from ${LOCAL_DDALAB_PATH}`);

        // Build the monolithic container in the local DDALAB directory
        await new Promise<void>((resolve, reject) => {
          const buildCommand = `cd "${LOCAL_DDALAB_PATH}" && docker build -t ddalab-monolith:latest -f Dockerfile .`;
          logger.info(`Executing build command: ${buildCommand}`);
          exec(buildCommand, (error, stdout, stderr) => {
            if (error) {
              logger.error(
                `Error building monolithic container: ${error.message}. Stderr: ${stderr}`
              );
              reject(
                new Error(
                  `Monolithic container build failed: ${stderr || error.message}`
                )
              );
              return;
            }
            logger.info(
              `Monolithic container build successful. Stdout: ${stdout}`
            );
            resolve();
          });
        });

        // Create a debug-specific docker-compose.yml with image references
        const targetPath = path.join(targetDir, "docker-compose.yml");

        let originalContent = await fs.readFile(
          path.join(LOCAL_DDALAB_PATH, "docker-compose.yml"),
          "utf8"
        );
        logger.info(
          "Original docker-compose.yml length:",
          originalContent.length
        );

        // Generate new docker-compose.yml for the monolithic service
        const monolithicComposeContent = `version: '3.8'

services:
  ddalab:
    image: ddalab-monolith:latest
    env_file:
      - ./.env
    ports:
      - "${userConfig.webPort || "3000"}:3000"
      - "${userConfig.apiPort || "8001"}:8001"
      - "${userConfig.apiPortMetrics || "8002"}:8002"
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_started
      redis:
        condition: service_started
    networks:
      - internal
    labels:
      - "traefik.enable=true"
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${process.env.DDALAB_DB_NAME || "ddalab"}
      POSTGRES_USER: ${process.env.DDALAB_DB_USER || "admin"}
      POSTGRES_PASSWORD: ${process.env.DDALAB_DB_PASSWORD || "dev_password123"}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \"$$POSTGRES_USER\" -d \"$$POSTGRES_DB\""]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s
    networks:
      - internal
    restart: unless-stopped

  minio:
    image: quay.io/minio/minio:latest
    environment:
      MINIO_ROOT_USER: ${process.env.MINIO_ROOT_USER || "admin"}
      MINIO_ROOT_PASSWORD: ${process.env.MINIO_ROOT_PASSWORD || "dev_password123"}
      MINIO_SERVER_URL: http://localhost:9000 # For internal use only
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
    networks:
      - internal
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - internal
    restart: unless-stopped

networks:
  internal:
    driver: bridge

volumes:
  postgres_data:
  minio_data:
  prometheus_data:
`;

        await fs.writeFile(targetPath, monolithicComposeContent);
        logger.info(
          `Debug docker-compose.yml saved to ${targetPath}, final length: ${monolithicComposeContent.length}`
        );

        // Copy all essential files
        const filesToCopy = ["traefik.yml", "prometheus.yml", "acme.json"];

        for (const file of filesToCopy) {
          const sourceFile = path.join(LOCAL_DDALAB_PATH, file);
          const targetFile = path.join(targetDir, file);

          try {
            await fs.copyFile(sourceFile, targetFile);
            logger.info(`Copied ${file} to ${targetFile}`);
          } catch (error: any) {
            logger.warn(`Could not copy ${file}: ${error.message}`);
          }
        }

        // Copy essential directories
        const directoriesToCopy = ["dynamic", "certs"];

        for (const dir of directoriesToCopy) {
          const sourceDir = path.join(LOCAL_DDALAB_PATH, dir);
          const targetDirPath = path.join(targetDir, dir);

          try {
            // Create target directory
            await fs.mkdir(targetDirPath, { recursive: true });

            // Copy all files from source directory
            const files = await fs.readdir(sourceDir);
            for (const file of files) {
              const sourceFilePath = path.join(sourceDir, file);
              const targetFilePath = path.join(targetDirPath, file);
              await fs.copyFile(sourceFilePath, targetFilePath);
            }
            logger.info(`Copied directory ${dir} to ${targetDirPath}`);
          } catch (error: any) {
            logger.warn(`Could not copy directory ${dir}: ${error.message}`);
          }
        }

        mainWindow.webContents.send("setup-progress", {
          message:
            "DEBUG MODE: Containers built and files copied successfully.",
        });
      } else {
        // Normal mode: clone from repository
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
      }

      // No longer need to fix Docker Compose file syntax errors after cloning
      // await this.fixDockerComposeFile(targetDir);

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

  /**
   * Fix Docker Compose file syntax errors after cloning
   */
  private static async fixDockerComposeFile(targetDir: string): Promise<void> {
    try {
      const dockerComposePath = path.join(targetDir, "docker-compose.yml");

      // Read the file
      let content = await fs.readFile(dockerComposePath, "utf-8");

      // Fix the malformed image references
      content = content.replace(
        /sdraeger1\/ddalab-web:\$\{VERSION:-latest\}\}/g,
        "sdraeger1/ddalab-web:${VERSION:-latest}"
      );
      content = content.replace(
        /sdraeger1\/ddalab-api:\$\{VERSION:-latest\}\}/g,
        "sdraeger1/ddalab-api:${VERSION:-latest}"
      );

      // Write the fixed content back
      await fs.writeFile(dockerComposePath, content, "utf-8");

      logger.info("Docker Compose file syntax errors fixed");
    } catch (error: any) {
      logger.warn("Failed to fix Docker Compose file:", error);
    }
  }
}
