import { app } from "electron";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";
import { EnvGeneratorService } from "./env-generator-service";
import { CertificateService } from "./certificate-service";
import type { UserSelections, ParsedEnvEntry } from "../utils/electron";

const DDALAB_SETUP_DIR_NAME = "ddalab-setup-data";
const CONFIG_MANAGER_STATE_FILE_NAME = "configmanager-state.json";
const LOCAL_DDALAB_PATH =
  process.env.DDALAB_LOCAL_PATH || "/Users/simon/Desktop/DDALAB";

export interface ConfigManagerState {
  setupComplete: boolean;
  setupPath: string | null;
  dataLocation?: string;
  projectLocation?: string;
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
          projectLocation: "",
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
    projectLocation?: string,
    additionalState?: Partial<ConfigManagerState>
  ): Promise<void> {
    const stateFilePath = this.getConfigManagerStateFilePath();

    let state: ConfigManagerState;
    if (projectLocation !== undefined) {
      // New format with separate locations
      state = {
        setupComplete: true,
        setupPath: projectLocation, // For backward compatibility, use projectLocation as setupPath
        dataLocation: setupPathOrDataLocation || undefined,
        projectLocation: projectLocation,
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
    projectLocation: string | null,
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
      projectLocation || undefined,
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
    
    // Ensure platform specification is present to prevent SIGTRAP errors
    await this.applyPlatformFix(targetDir);

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
DDALAB_IMAGE=sdraeger1/ddalab:latest

# Database Configuration
DDALAB_DB_USER=admin
DDALAB_DB_PASSWORD=${userConfig.dbPassword || "ddalab_password"}
DDALAB_DB_NAME=postgres
DDALAB_DB_HOST=postgres
DDALAB_DB_PORT=5432
# Docker Compose DB variables
DB_USER=admin
DB_PASSWORD=${userConfig.dbPassword || "ddalab_password"}
DB_NAME=postgres
# PostgreSQL Environment Variables (Primary)
POSTGRES_USER=admin
POSTGRES_PASSWORD=${userConfig.dbPassword || "ddalab_password"}
POSTGRES_DB=postgres
# Database URL for applications
DATABASE_URL=postgresql+asyncpg://admin:${userConfig.dbPassword || "ddalab_password"}@postgres:5432/postgres
# Database connection retry settings
DB_RETRY_ATTEMPTS=10
DB_RETRY_DELAY=5
# Health check configuration
POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256

# MinIO Configuration
MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=${userConfig.minioPassword || "ddalab_password"}
MINIO_HOST=minio:9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=${userConfig.minioPassword || "ddalab_password"}

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
# Docker Compose API Port
API_PORT=${userConfig.apiPort || "8001"}
DDALAB_RELOAD=False
DDALAB_INSTITUTION_NAME=DDALAB
DDALAB_DATA_DIR=./data

# Authentication Configuration
DDALAB_JWT_SECRET_KEY=ddalab-auth-secret-key-${
      new Date().toISOString().split("T")[0]
    }
DDALAB_JWT_ALGORITHM=HS256
DDALAB_TOKEN_EXPIRATION_MINUTES=60
DDALAB_AUTH_MODE=${userConfig.authMode || "local"}

# Traefik Configuration
TRAEFIK_ACME_EMAIL=${userConfig.traefikEmail || "admin@ddalab.local"}
TRAEFIK_PASSWORD_HASH='admin:$2y$10$example'
# Grafana Configuration
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin_password

# Allowed Directories for API access
DDALAB_ALLOWED_DIRS=/app/data
# Dynamic volume mount configuration (parsed from allowedDirs)
ALLOWED_DIR_SOURCE=./data
ALLOWED_DIR_TARGET=/app/data

# Analysis Configuration
DDALAB_MAX_CONCURRENT_TASKS=5
DDALAB_TASK_TIMEOUT=300
DDALAB_DDA_BINARY_PATH=/app/bin/run_DDA_ASCII

# SSL Configuration
DDALAB_SSL_ENABLED=False

# Next.js Configuration
DDALAB_DEBUG_NEXTJS=true
# Fix for Next.js standalone mode
NEXT_BUILD_MODE=standalone
NODE_ENV=production
# Disable problematic Next.js features for Docker
NEXT_TELEMETRY_DISABLED=1

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
    // Parse allowed directories to extract source and target for volume mount
    let allowedDirSource = "./data";
    let allowedDirTarget = "/app/data";
    
    if (userConfig.allowedDirs) {
      const allowedDirsParts = userConfig.allowedDirs.split(":");
      if (allowedDirsParts.length >= 2) {
        allowedDirSource = allowedDirsParts[0];
        allowedDirTarget = allowedDirsParts[1];
      }
    }
    
    const updates = {
      DDALAB_ALLOWED_DIRS: allowedDirTarget, // API should only know about container paths
      ALLOWED_DIR_SOURCE: allowedDirSource, // For docker-compose volume mount
      ALLOWED_DIR_TARGET: allowedDirTarget, // For docker-compose volume mount
      WEB_PORT: userConfig.webPort || "3000",
      DDALAB_API_PORT: userConfig.apiPort || "8001",
      API_PORT: userConfig.apiPort || "8001", // For Docker Compose
      DDALAB_DB_PASSWORD: userConfig.dbPassword || "ddalab_password",
      DB_USER: "admin", // For Docker Compose
      DB_PASSWORD: userConfig.dbPassword || "ddalab_password", // For Docker Compose
      DB_NAME: "postgres", // For Docker Compose
      POSTGRES_USER: "admin", // Primary PostgreSQL environment variable
      POSTGRES_PASSWORD: userConfig.dbPassword || "ddalab_password", // Primary PostgreSQL environment variable
      POSTGRES_DB: "postgres", // Primary PostgreSQL environment variable
      MINIO_ROOT_PASSWORD: userConfig.minioPassword || "ddalab_password",
      TRAEFIK_ACME_EMAIL: userConfig.traefikEmail || "admin@ddalab.local",
      TRAEFIK_PASSWORD_HASH: "'admin:$2y$10$example'", // Basic placeholder
      GRAFANA_ADMIN_USER: "admin", // For Docker Compose
      GRAFANA_ADMIN_PASSWORD: "admin_password", // For Docker Compose
      DDALAB_AUTH_MODE: userConfig.authMode || "local",
      DDALAB_IMAGE: "sdraeger1/ddalab:latest",
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
   * Ensure the ddalab service has platform: linux/amd64 to prevent SIGTRAP errors
   */
  private static ensureDdalabPlatform(composeContent: string): string {
    // Simple regex-based approach to ensure platform exists only for ddalab service
    
    // Check if ddalab service already has platform specification
    const ddalabServiceMatch = composeContent.match(/(\s*)ddalab:\s*\n((?:\1\s+.*\n)*)/);
    if (!ddalabServiceMatch) {
      // No ddalab service found, return unchanged
      return composeContent;
    }
    
    const serviceIndent = ddalabServiceMatch[1];
    const serviceContent = ddalabServiceMatch[2];
    const propertyIndent = serviceIndent + '    '; // Standard 4 spaces for service properties
    
    // Check if platform already exists in the ddalab service
    if (serviceContent.includes('platform:')) {
      // Platform already exists, return unchanged
      return composeContent;
    }
    
    // Add platform after the image line in ddalab service
    const imageLinePattern = new RegExp(`(${serviceIndent}ddalab:\\s*\\n(?:${propertyIndent}.*\\n)*?${propertyIndent}image:[^\\n]*\\n)`, 'g');
    const replacement = `$1${propertyIndent}platform: linux/amd64\n`;
    
    return composeContent.replace(imageLinePattern, replacement);
  }

  /**
   * Clean up malformed docker-compose.yml files (remove duplicates, fix indentation)
   */
  static async cleanupDockerCompose(setupPath: string): Promise<void> {
    const composePath = path.join(setupPath, "docker-compose.yml");
    
    try {
      // Check if the file exists
      await fs.access(composePath);
      
      // Read the current content
      let composeContent = await fs.readFile(composePath, "utf-8");
      
      // Clean up the content
      const lines = composeContent.split('\n');
      const cleanedLines: string[] = [];
      const seenPlatforms = new Set<string>();
      let currentService = '';
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Detect service sections (top-level services under 'services:')
        if (trimmed.endsWith(':') && line.match(/^  \w+:$/)) {
          currentService = trimmed.replace(':', '');
          seenPlatforms.clear();
          cleanedLines.push(line);
          continue;
        }
        
        // Handle platform lines
        if (trimmed.startsWith('platform:')) {
          const serviceKey = `${currentService}:platform`;
          if (!seenPlatforms.has(serviceKey) && currentService === 'ddalab') {
            // Only add platform for ddalab service (to prevent SIGTRAP)
            // Fix indentation - platform should be at service property level
            const serviceIndent = '  '; // Standard YAML indent
            cleanedLines.push(`${serviceIndent}platform: linux/amd64`);
            seenPlatforms.add(serviceKey);
          }
          // Skip all platform lines (duplicates and non-ddalab services)
          continue;
        }
        
        cleanedLines.push(line);
      }
      
      const cleanedContent = cleanedLines.join('\n');
      
      // Write back the cleaned content
      await fs.writeFile(composePath, cleanedContent, "utf-8");
      
      logger.info(`Cleaned up malformed docker-compose.yml at ${composePath}`);
    } catch (error) {
      logger.warn(`Could not cleanup docker-compose.yml at ${composePath}:`, error);
    }
  }

  /**
   * Apply platform fix to existing docker-compose.yml files
   */
  static async applyPlatformFix(setupPath: string): Promise<void> {
    try {
      const composePath = path.join(setupPath, "docker-compose.yml");
      
      // Check if this is already a monolithic setup with ddalab service
      const initialComposeContent = await fs.readFile(composePath, "utf-8");
      const hasDdalabServiceFix = initialComposeContent.includes('  ddalab:');
      const hasWebServiceFix = initialComposeContent.includes('  web:');
      const hasApiServiceFix = initialComposeContent.includes('  api:');
      
      // If we already have ddalab service and no web/api, skip platform fix
      if (hasDdalabServiceFix && !hasWebServiceFix && !hasApiServiceFix) {
        logger.info(`Docker compose already configured for monolithic ddalab service, skipping platform fix`);
        return;
      }
      
      // First clean up any malformed YAML (duplicates, bad indentation)
      await this.cleanupDockerCompose(setupPath);
      
      // Check if the file exists
      await fs.access(composePath);
      
      // Read the current content
      let composeContent = await fs.readFile(composePath, "utf-8");
      
      // Apply the platform fix (only for ddalab service to prevent over-application)
      composeContent = this.ensureDdalabPlatform(composeContent);
      
      // Write back the updated content
      await fs.writeFile(composePath, composeContent, "utf-8");
      
      logger.info(`Applied platform fix to ${composePath}`);
    } catch (error) {
      logger.warn(`Could not apply platform fix to ${setupPath}:`, error);
    }
  }

  /**
   * Generate docker-compose.volumes.yml based on allowed directories
   */
  static async generateVolumeConfig(
    targetDir: string,
    userConfig: UserConfiguration
  ): Promise<void> {
    // Parse allowedDirs to create bind mounts
    let bindMounts = "";
    let allowedDirsString = "";

    if (userConfig && userConfig.allowedDirs) {
      allowedDirsString = userConfig.allowedDirs;
      const allowedDirsParts = userConfig.allowedDirs.split(":");
      
      if (allowedDirsParts.length >= 2) {
        const sourcePath = allowedDirsParts[0];
        const targetPath = allowedDirsParts[1];
        const permissions = allowedDirsParts[2] || "rw";

        bindMounts = `      - type: bind
        source: ${sourcePath}
        target: ${targetPath}`;
      }
    }

    const volumesContent = `# Auto-generated volume configuration for monolithic container
# Generated from DDALAB_ALLOWED_DIRS: ${allowedDirsString || 'none'}

services:
  ddalab:
    volumes:
      - prometheus_data:/tmp/prometheus${bindMounts ? "\n" + bindMounts : ""}
`;

    const volumesFilePath = path.join(targetDir, "docker-compose.volumes.yml");
    await fs.writeFile(volumesFilePath, volumesContent, "utf-8");
  }

  /**
   * Fix PostgreSQL health check configuration to match working version
   */
  static fixPostgreSQLHealthCheck(composeContent: string): string {
    // Update PostgreSQL environment variables to match working configuration
    composeContent = composeContent.replace(
      /POSTGRES_USER: \$\{DB_USER:-admin\}/g,
      "POSTGRES_USER: ${POSTGRES_USER:-admin}"
    );
    composeContent = composeContent.replace(
      /POSTGRES_PASSWORD: \$\{DB_PASSWORD:-ddalab_password\}/g,
      "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-ddalab_password}"
    );
    composeContent = composeContent.replace(
      /POSTGRES_DB: \$\{DB_NAME:-postgres\}/g,
      "POSTGRES_DB: ${POSTGRES_DB:-postgres}"
    );

    // Fix PostgreSQL health check command to use environment variables properly
    composeContent = composeContent.replace(
      /test: \["CMD-SHELL", "pg_isready -U admin -d postgres"\]/g,
      'test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-admin} -d ${POSTGRES_DB:-postgres}"]'
    );

    return composeContent;
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
      // Use static template instead of dynamic generation
      await this.copyDockerComposeTemplate(targetDir);
      logger.info(`Updated docker-compose.yml from static template`);

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

          // Keep platform specifications to prevent architecture issues

          cleanedLines.push(line);
        }

        composeContent = cleanedLines.join("\n");
      }

      // Replace individual service images with the monolithic image
      composeContent = composeContent.replace(
        /image: sdraeger1\/ddalab-web:.*$/m,
        "image: sdraeger1/ddalab:${VERSION:-latest}"
      );
      composeContent = composeContent.replace(
        /image: sdraeger1\/ddalab-api:.*$/m,
        "# Removed: API service merged into monolith"
      );

      // Fix PostgreSQL health check configuration to match working version
      composeContent = this.fixPostgreSQLHealthCheck(composeContent);

      // Ensure the ddalab service has platform specification to prevent SIGTRAP
      composeContent = this.ensureDdalabPlatform(composeContent);

      // Check if ddalab service already exists - if so, skip the web/api conversion
      const hasDdalabService = composeContent.includes('  ddalab:');
      const hasWebService = composeContent.includes('  web:');
      const hasApiService = composeContent.includes('  api:');
      
      // Only convert web/api to ddalab if we have web/api services but no ddalab service
      if ((hasWebService || hasApiService) && !hasDdalabService) {
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
            updatedLines.push("    image: ${DDALAB_IMAGE:-sdraeger1/ddalab:latest}");
            updatedLines.push("    platform: linux/amd64");
            updatedLines.push("    env_file:");
            updatedLines.push("      - ./.env");
            updatedLines.push("    ports:");
            updatedLines.push('      - "${WEB_PORT:-3000}:3000"');
            updatedLines.push('      - "${API_PORT:-8001}:8001"');
            updatedLines.push("    healthcheck:");
            updatedLines.push(
              '      test: ["CMD-SHELL", "curl -f http://localhost:3000 || exit 1"]'
            );
            updatedLines.push("      interval: 15s");
            updatedLines.push("      timeout: 10s");
            updatedLines.push("      retries: 20");
            updatedLines.push("      start_period: 120s");
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
      
      // Debug: Log lines around where the error occurs
      const debugLines = composeContent.split('\n');
      logger.info(`DEBUG - Generated line 14: "${debugLines[13] || 'undefined'}"`);
      logger.info(`DEBUG - Generated line 15: "${debugLines[14] || 'undefined'}"`);
      logger.info(`DEBUG - Generated line 16: "${debugLines[15] || 'undefined'}"`);
      
      logger.info(`Converted web/api services to monolithic ddalab service`);
      } else {
        logger.info(`Ddalab service already exists, skipping web/api conversion`);
      }

      await fs.writeFile(composePath, composeContent, "utf-8");
      logger.info(`Updated docker-compose.yml for monolithic usage`);
    } catch (error) {
      logger.warn(`Could not update docker-compose.yml: ${error}`);
    }
  }

  /**
   * Copy the static docker-compose template to the target directory
   */
  static async copyDockerComposeTemplate(targetDir: string): Promise<void> {
    // Use app.getAppPath() to get the correct path to bundled assets
    const { app } = require('electron');
    const appPath = app.getAppPath();
    const templatePath = path.join(appPath, 'src/assets/docker-compose.template.yml');
    const composePath = path.join(targetDir, 'docker-compose.yml');
    
    try {
      logger.info(`Looking for template at: ${templatePath}`);
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      await fs.writeFile(composePath, templateContent, 'utf-8');
      logger.info(`Copied docker-compose template to ${composePath}`);
    } catch (error) {
      logger.error(`Failed to copy docker-compose template from ${templatePath}: ${error}`);
      // Fallback: try relative to current working directory
      try {
        const fallbackPath = path.join(process.cwd(), 'packages/configmanager/src/assets/docker-compose.template.yml');
        logger.info(`Trying fallback path: ${fallbackPath}`);
        const templateContent = await fs.readFile(fallbackPath, 'utf-8');
        await fs.writeFile(composePath, templateContent, 'utf-8');
        logger.info(`Copied docker-compose template from fallback path to ${composePath}`);
      } catch (fallbackError) {
        logger.error(`Fallback also failed: ${fallbackError}`);
        throw error;
      }
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

    // Setup SSL certificates
    await this.setupSSLCertificates(targetDir);

    mainWindow.webContents.send("setup-progress", {
      message: "Security files configured.",
    });
  }

  /**
   * Setup SSL certificates - tries trusted certificates first, falls back to self-signed
   */
  static async setupSSLCertificates(targetDir: string): Promise<void> {
    const mainWindow = getMainWindow();
    const certsDir = path.join(targetDir, "certs");

    try {
      // Ensure certs directory exists
      await fs.mkdir(certsDir, { recursive: true });

      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "Setting up SSL certificates...",
          step: "certificates"
        });
      }

      logger.info("Setting up SSL certificates for DDALAB");

      // Check if mkcert is available
      const mkcertAvailable = await CertificateService.isMkcertAvailable();
      
      if (mkcertAvailable) {
        logger.info("mkcert is available, generating trusted certificates");
        
        if (mainWindow) {
          mainWindow.webContents.send("setup-progress", {
            message: "Generating trusted SSL certificates (no browser warnings)...",
            step: "certificates"
          });
        }

        const result = await CertificateService.generateTrustedCertificates(certsDir);
        
        if (result.success) {
          logger.info("Trusted SSL certificates generated successfully");
          
          if (mainWindow) {
            mainWindow.webContents.send("setup-progress", {
              message: "✅ Trusted SSL certificates generated successfully",
              step: "certificates",
              type: "success"
            });
          }
          return;
        } else {
          // Check if it's a Firefox-related error but certificates were actually generated
          if (result.error && result.error.includes("Firefox") && result.error.includes("certutil")) {
            logger.info("Firefox database error detected, checking if certificates were generated anyway...");
            
            // Check if certificates actually exist despite the error
            const certInfo = await CertificateService.getCertificateInfo(certsDir);
            if (certInfo.exists && certInfo.valid) {
              logger.info("Certificates were generated successfully despite Firefox database error");
              
              if (mainWindow) {
                mainWindow.webContents.send("setup-progress", {
                  message: "✅ Trusted certificates generated (Firefox database warning ignored)",
                  step: "certificates",
                  type: "success"
                });
              }
              return;
            }
          }
          
          logger.warn("Failed to generate trusted certificates, falling back to self-signed:", result.error);
        }
      } else {
        logger.info("mkcert not available, will try to install it");
        
        if (mainWindow) {
          mainWindow.webContents.send("setup-progress", {
            message: "Installing mkcert for trusted certificates...",
            step: "certificates"
          });
        }

        // Try to install mkcert automatically
        const installResult = await CertificateService.installMkcert();
        if (installResult.success) {
          logger.info("mkcert installed successfully, generating trusted certificates");
          
          const result = await CertificateService.generateTrustedCertificates(certsDir);
          if (result.success) {
            logger.info("Trusted SSL certificates generated after mkcert installation");
            
            if (mainWindow) {
              mainWindow.webContents.send("setup-progress", {
                message: "✅ mkcert installed and trusted certificates generated",
                step: "certificates",
                type: "success"
              });
            }
            return;
          } else {
            // Check if it's a Firefox-related error but certificates were actually generated
            if (result.error && result.error.includes("Firefox") && result.error.includes("certutil")) {
              logger.info("Firefox database error detected, checking if certificates were generated anyway...");
              
              // Check if certificates actually exist despite the error
              const certInfo = await CertificateService.getCertificateInfo(certsDir);
              if (certInfo.exists && certInfo.valid) {
                logger.info("Certificates were generated successfully despite Firefox database error");
                
                if (mainWindow) {
                  mainWindow.webContents.send("setup-progress", {
                    message: "✅ Trusted certificates generated (Firefox database warning ignored)",
                    step: "certificates",
                    type: "success"
                  });
                }
                return;
              }
            }
            
            logger.warn("Failed to generate trusted certificates after installation:", result.error);
          }
        } else {
          logger.info("Could not install mkcert automatically:", installResult.error);
        }
      }

      // Fallback to self-signed certificates
      logger.info("Generating self-signed SSL certificates as fallback");
      
      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "Generating self-signed SSL certificates (browsers will show warnings)...",
          step: "certificates"
        });
      }

      const fallbackResult = await CertificateService.generateSelfSignedCertificates(certsDir);
      
      if (fallbackResult.success) {
        logger.info("Self-signed SSL certificates generated successfully");
        
        if (mainWindow) {
          mainWindow.webContents.send("setup-progress", {
            message: "⚠️ Self-signed certificates generated (browsers will show security warnings)",
            step: "certificates",
            type: "warning"
          });
        }
      } else {
        logger.error("Failed to generate SSL certificates:", fallbackResult.error);
        
        if (mainWindow) {
          mainWindow.webContents.send("setup-progress", {
            message: "❌ Failed to generate SSL certificates",
            step: "certificates",
            type: "error"
          });
        }
        
        // Don't fail the entire setup, but log the error
        logger.warn("Continuing setup without SSL certificates");
      }

    } catch (error) {
      logger.error("Error setting up SSL certificates:", error);
      
      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "❌ Error setting up SSL certificates",
          step: "certificates",
          type: "error"
        });
      }
      
      // Don't fail the entire setup
      logger.warn("Continuing setup without SSL certificates");
    }
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

    // Validate SSL certificates
    await this.validateSSLCertificates(targetDir);

    mainWindow.webContents.send("setup-progress", {
      message: "Setup validation completed successfully.",
    });
  }

  /**
   * Validate SSL certificates and generate if missing or invalid
   */
  static async validateSSLCertificates(targetDir: string): Promise<void> {
    const mainWindow = getMainWindow();
    const certsDir = path.join(targetDir, "certs");
    
    try {
      // Check if certificates exist and are valid
      const certInfo = await CertificateService.getCertificateInfo(certsDir);
      
      if (!certInfo.exists || !certInfo.valid) {
        logger.warn("SSL certificates are missing or invalid, generating new ones");
        
        if (mainWindow) {
          mainWindow.webContents.send("setup-progress", {
            message: "SSL certificates missing or invalid, generating new ones...",
            step: "certificate-validation"
          });
        }
        
        // Generate new certificates
        await this.setupSSLCertificates(targetDir);
      } else {
        logger.info("SSL certificates are valid");
        
        if (mainWindow) {
          const trustMessage = certInfo.isTrusted 
            ? "SSL certificates are valid and trusted (no browser warnings)"
            : "SSL certificates are valid but self-signed (browsers will show warnings)";
            
          mainWindow.webContents.send("setup-progress", {
            message: trustMessage,
            step: "certificate-validation",
            type: certInfo.isTrusted ? "success" : "warning"
          });
        }
      }
    } catch (error: any) {
      logger.error("Error validating SSL certificates:", error);
      
      if (mainWindow) {
        mainWindow.webContents.send("setup-progress", {
          message: "Warning: Could not validate SSL certificates",
          step: "certificate-validation",
          type: "warning"
        });
      }
    }
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

      // Always copy essential files from local DDALAB installation
      // This ensures all necessary configuration files are available
      mainWindow.webContents.send("setup-progress", {
        message: `Copying DDALAB configuration files from ${LOCAL_DDALAB_PATH}...`,
      });

      logger.info(`Copying essential files from local DDALAB directory: ${LOCAL_DDALAB_PATH}`);

      // Copy the main docker-compose.yml file
      const sourceComposePath = path.join(LOCAL_DDALAB_PATH, "docker-compose.yml");
      const targetComposePath = path.join(targetDir, "docker-compose.yml");
      
      try {
        await fs.copyFile(sourceComposePath, targetComposePath);
        logger.info(`Copied docker-compose.yml to ${targetComposePath}`);
      } catch (error: any) {
        logger.error(`Could not copy docker-compose.yml: ${error.message}`);
        throw new Error(`Failed to copy docker-compose.yml: ${error.message}`);
      }

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

      // Copy essential directories (except certs - we'll generate those)
      const directoriesToCopy = ["dynamic"];

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

      // Generate SSL certificates instead of copying them
      await this.setupSSLCertificates(targetDir);

      mainWindow.webContents.send("setup-progress", {
        message: "Essential DDALAB files copied successfully.",
      });

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

  /**
   * Validate that a setup is complete and all required files exist
   */
  static async validateSetup(setupPath: string): Promise<boolean> {
    try {
      logger.info(`Validating setup at: ${setupPath}`);
      
      // Check if setup directory exists
      const setupDir = await fs.stat(setupPath);
      if (!setupDir.isDirectory()) {
        logger.warn(`Setup directory does not exist: ${setupPath}`);
        return false;
      }

      // Check for essential files
      const requiredFiles = ["docker-compose.yml", ".env"];
      for (const file of requiredFiles) {
        const filePath = path.join(setupPath, file);
        try {
          await fs.access(filePath);
          logger.info(`Required file found: ${filePath}`);
        } catch {
          logger.warn(`Required file missing: ${filePath}`);
          return false;
        }
      }

      // Check for essential directories
      const requiredDirs = ["data"];
      for (const dir of requiredDirs) {
        const dirPath = path.join(setupPath, dir);
        try {
          const dirStat = await fs.stat(dirPath);
          if (!dirStat.isDirectory()) {
            logger.warn(`Required directory is not a directory: ${dirPath}`);
            return false;
          }
          logger.info(`Required directory found: ${dirPath}`);
        } catch {
          logger.warn(`Required directory missing: ${dirPath}`);
          return false;
        }
      }

      logger.info(`Setup validation successful: ${setupPath}`);
      return true;
    } catch (error) {
      logger.error(`Setup validation failed: ${error}`);
      return false;
    }
  }

  /**
   * Re-run setup if validation fails
   */
  static async ensureValidSetup(projectLocation: string, userConfig?: UserConfiguration): Promise<SetupResult> {
    const isValid = await this.validateSetup(projectLocation);
    
    if (!isValid) {
      logger.warn(`Setup validation failed for ${projectLocation}, re-running setup`);
      
      // Use default config if none provided
      const defaultConfig: UserConfiguration = userConfig || {
        dataLocation: path.join(projectLocation, "data"),
        allowedDirs: `${path.join(projectLocation, "data")}:/app/data:rw`,
        webPort: "3000",
        apiPort: "8001",
        dbPassword: "ddalab_password",
        minioPassword: "ddalab_password",
        traefikEmail: "admin@ddalab.local",
        useDockerHub: true
      };
      
      return await this.setupDDALAB(projectLocation, defaultConfig);
    }
    
    // Always apply platform fix to ensure ddalab container uses AMD64 (prevents SIGTRAP)
    try {
      await this.applyPlatformFix(projectLocation);
    } catch (error) {
      logger.warn(`Failed to apply platform fix: ${error}`);
    }
    
    return {
      success: true,
      message: "Setup validation passed",
      setupPath: projectLocation
    };
  }
}
