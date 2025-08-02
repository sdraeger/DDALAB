import { app } from "electron";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";

export interface EnvironmentConfig {
  mode: "development" | "testing" | "production";
  dockerProjectPrefix: string;
  envFile: string;
  userDataPath: string;
  ports: {
    web: number;
    api: number;
    traefik: number;
  };
  volumes: {
    prefix: string;
    network: string;
  };
}

export class EnvironmentIsolationService {
  private static currentConfig: EnvironmentConfig | null = null;

  static async initialize(): Promise<EnvironmentConfig> {
    const mode = this.detectEnvironmentMode();
    const config = this.createEnvironmentConfig(mode);

    // Set up userData isolation
    this.setupUserDataIsolation(config);

    // Set up environment file isolation
    this.setupEnvironmentFileIsolation(config);

    // Clear state for testing mode to ensure isolation
    if (mode === "testing") {
      await this.clearTestingState();
    }

    this.currentConfig = config;
    logger.info(`Environment isolation initialized for mode: ${mode}`, config);

    return config;
  }

  static getCurrentConfig(): EnvironmentConfig {
    if (!this.currentConfig) {
      throw new Error(
        "Environment isolation not initialized. Call initialize() first."
      );
    }
    return this.currentConfig;
  }

  private static detectEnvironmentMode():
    | "development"
    | "testing"
    | "production" {
    // Check for explicit environment variables
    if (
      process.env.NODE_ENV === "test" ||
      process.env.ELECTRON_IS_TESTING === "true"
    ) {
      return "testing";
    }

    if (
      process.env.NODE_ENV === "production" ||
      process.env.ELECTRON_IS_PRODUCTION === "true"
    ) {
      return "production";
    }

    // Default to development
    return "development";
  }

  private static createEnvironmentConfig(
    mode: "development" | "testing" | "production"
  ): EnvironmentConfig {
    const basePorts = {
      web: 3000,
      api: 8000,
      traefik: 80,
    };

    const configs = {
      development: {
        mode: "development" as const,
        dockerProjectPrefix: "ddalab-dev",
        envFile: ".env", // Consolidated environment file
        userDataPath: path.join(app.getPath("userData"), "development"),
        ports: {
          web: basePorts.web,
          api: basePorts.api,
          traefik: basePorts.traefik,
        },
        volumes: {
          prefix: "ddalab_dev",
          network: "ddalab_dev_network",
        },
      },
      testing: {
        mode: "testing" as const,
        dockerProjectPrefix: "ddalab-test",
        envFile: ".env", // Consolidated environment file
        userDataPath: path.join(app.getPath("userData"), "testing"),
        ports: {
          web: basePorts.web + 1000, // 4000
          api: basePorts.api + 1000, // 9000
          traefik: basePorts.traefik + 1000, // 1080
        },
        volumes: {
          prefix: "ddalab_test",
          network: "ddalab_test_network",
        },
      },
      production: {
        mode: "production" as const,
        dockerProjectPrefix: "ddalab-prod",
        envFile: ".env", // Consolidated environment file
        userDataPath: path.join(app.getPath("userData"), "production"),
        ports: {
          web: basePorts.web,
          api: basePorts.api,
          traefik: basePorts.traefik,
        },
        volumes: {
          prefix: "ddalab_prod",
          network: "ddalab_prod_network",
        },
      },
    };

    return configs[mode];
  }

  private static setupUserDataIsolation(config: EnvironmentConfig): void {
    // Override userData path to prevent contamination
    app.setPath("userData", config.userDataPath);

    // Ensure the directory exists
    fs.mkdir(config.userDataPath, { recursive: true }).catch((error) => {
      logger.error(`Failed to create userData directory: ${error.message}`);
    });

    logger.info(`UserData path set to: ${config.userDataPath}`);
  }

  private static setupEnvironmentFileIsolation(
    config: EnvironmentConfig
  ): void {
    // This will be used when loading environment files
    // The actual file loading is handled in the setup service
    logger.info(`Environment file set to: ${config.envFile}`);
  }

  private static async clearTestingState(): Promise<void> {
    try {
      // Import SetupService here to avoid circular dependencies
      const { SetupService } = await import("./setup-service");
      await SetupService.clearConfigManagerState();
      logger.info("Testing state cleared for isolation");

      // Also clear Docker resources for testing isolation
      const { DockerService } = await import("./docker-service");
      await DockerService.clearTestingResources();
      logger.info("Docker testing resources cleared for isolation");
    } catch (error: any) {
      logger.error("Failed to clear testing state:", error);
    }
  }

  static getDockerProjectName(setupPath: string): string {
    const config = this.getCurrentConfig();
    const baseName = path
      .basename(setupPath)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return `${config.dockerProjectPrefix}-${baseName}`;
  }

  static getDockerComposeCommand(setupPath: string): string {
    const config = this.getCurrentConfig();
    const projectName = this.getDockerProjectName(setupPath);

    // Use -p flag for project name isolation with Docker Compose V2
    return `docker compose -p ${projectName} -f docker-compose.yml -f docker-compose.volumes.yml`;
  }

  static getEnvironmentFilePath(setupPath: string): string {
    const config = this.getCurrentConfig();
    return path.join(setupPath, config.envFile);
  }

  static getFallbackEnvironmentFilePath(setupPath: string): string {
    // Fallback to .env if mode-specific file doesn't exist
    return path.join(setupPath, ".env");
  }

  static async ensureEnvironmentFileExists(setupPath: string): Promise<string> {
    const config = this.getCurrentConfig();
    const envFilePath = this.getEnvironmentFilePath(setupPath);
    const fallbackPath = this.getFallbackEnvironmentFilePath(setupPath);

    try {
      // Check if mode-specific env file exists
      await fs.access(envFilePath);
      logger.info(`Using environment file: ${envFilePath}`);
      return envFilePath;
    } catch {
      // Fallback to .env
      try {
        await fs.access(fallbackPath);
        logger.info(`Using fallback environment file: ${fallbackPath}`);
        return fallbackPath;
      } catch {
        // Create a default .env file if it doesn't exist
        logger.warn(
          `No environment file found. Creating default .env file at: ${fallbackPath}`
        );

        // Import SetupService to generate default env content
        const { SetupService } = await import("./setup-service");

        // Create default user configuration
        const defaultUserConfig = {
          dataLocation: setupPath,
          allowedDirs: `${setupPath}:/app/data:rw`,
          webPort: "3000",
          apiPort: "8001",
          dbPassword: "ddalab_password",
          minioPassword: "ddalab_password",
          traefikEmail: "admin@ddalab.local",
          useDockerHub: true,
          authMode: "local", // Default to local mode for easier setup
        };

        // Generate default env content
        const defaultEnvContent =
          SetupService.generateDefaultEnvContent(defaultUserConfig);

        // Write the default .env file
        await fs.writeFile(fallbackPath, defaultEnvContent, "utf-8");
        logger.info(`Created default .env file at: ${fallbackPath}`);

        return fallbackPath;
      }
    }
  }

  static getVolumeName(volumeType: string): string {
    const config = this.getCurrentConfig();
    return `${config.volumes.prefix}_${volumeType}`;
  }

  static getNetworkName(): string {
    const config = this.getCurrentConfig();
    return config.volumes.network;
  }

  static getPorts(): { web: number; api: number; traefik: number } {
    const config = this.getCurrentConfig();
    return config.ports;
  }

  static isTestingMode(): boolean {
    const config = this.getCurrentConfig();
    return config.mode === "testing";
  }

  static isDevelopmentMode(): boolean {
    const config = this.getCurrentConfig();
    return config.mode === "development";
  }

  static isProductionMode(): boolean {
    const config = this.getCurrentConfig();
    return config.mode === "production";
  }

  static getMode(): string {
    const config = this.getCurrentConfig();
    return config.mode;
  }
}
