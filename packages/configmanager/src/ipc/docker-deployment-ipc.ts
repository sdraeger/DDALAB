import { ipcMain } from "electron";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { SetupService, UserConfiguration } from "../services/setup-service";
import { EnvironmentIsolationService } from "../services/environment-isolation";

export function registerDockerDeploymentIpcHandlers() {
  // Validate Docker setup
  ipcMain.handle("validate-docker-setup", async (event, setupPath: string) => {
    try {
      logger.info(`Validating Docker setup at: ${setupPath}`);

      // Check if the directory exists
      const setupDir = await fs.stat(setupPath);
      if (!setupDir.isDirectory()) {
        return {
          success: false,
          message: "Selected path is not a directory",
        };
      }

      // Check for docker-compose.yml
      const dockerComposePath = path.join(setupPath, "docker-compose.yml");

      try {
        await fs.access(dockerComposePath);

        // Use ensureEnvironmentFileExists to handle missing .env file
        try {
          await EnvironmentIsolationService.ensureEnvironmentFileExists(
            setupPath
          );
          logger.info("Docker setup validation successful");
          return {
            success: true,
            message: "Docker setup is valid",
            setupPath,
          };
        } catch (envError) {
          logger.warn(`Environment file issue: ${envError}`);
          return {
            success: false,
            message: "Docker setup files not found",
            needsSetup: true,
            targetPath: setupPath,
          };
        }
      } catch (error) {
        // Files don't exist, needs setup
        return {
          success: false,
          message: "Docker setup files not found",
          needsSetup: true,
          targetPath: setupPath,
        };
      }
    } catch (error) {
      logger.error("Docker setup validation failed:", error);
      return {
        success: false,
        message: `Validation failed: ${String(error)}`,
      };
    }
  });

  // Setup Docker deployment using enhanced approach
  ipcMain.handle(
    "setup-docker-deployment",
    async (
      event,
      dataLocation: string,
      setupLocation: string,
      userConfig: UserConfiguration
    ) => {
      try {
        logger.info(
          `Setting up Docker deployment at: ${setupLocation} with user config:`,
          userConfig
        );

        // Use the enhanced setup method
        const result = await SetupService.setupDDALAB(
          setupLocation,
          userConfig
        );

        if (result.success) {
          await SetupService.saveConfigManagerState(
            dataLocation,
            setupLocation
          );
          logger.info("Docker deployment setup completed successfully");
        }

        return result;
      } catch (error: any) {
        logger.error("Docker deployment setup failed:", error);
        return {
          success: false,
          message: `Docker deployment setup failed: ${error.message}`,
        };
      }
    }
  );

  // Setup Docker directory with enhanced approach
  ipcMain.handle(
    "setup-docker-directory",
    async (event, targetDirectory: string, userConfig: UserConfiguration) => {
      try {
        logger.info(
          `Setting up Docker directory at: ${targetDirectory} with user config:`,
          userConfig
        );

        // Use the enhanced setup method
        const result = await SetupService.setupDDALAB(
          targetDirectory,
          userConfig
        );

        if (result.success) {
          await SetupService.saveConfigManagerState(
            targetDirectory,
            targetDirectory
          );
          logger.info("Docker directory setup completed successfully");
        }

        return result;
      } catch (error: any) {
        logger.error("Docker directory setup failed:", error);
        return {
          success: false,
          message: `Docker directory setup failed: ${error.message}`,
        };
      }
    }
  );

  // Legacy method for backward compatibility
  ipcMain.handle(
    "setup-docker-deployment-legacy",
    async (event, dataLocation: string, setupLocation: string) => {
      try {
        logger.info(
          `Setting up Docker deployment (legacy) at: ${setupLocation}`
        );

        // Create setup directory if it doesn't exist
        await fs.mkdir(setupLocation, { recursive: true });

        // Create data directory
        const dataDir = path.join(setupLocation, "data");
        await fs.mkdir(dataDir, { recursive: true });

        // Create dynamic directory for Traefik
        const dynamicDir = path.join(setupLocation, "dynamic");
        await fs.mkdir(dynamicDir, { recursive: true });

        // Create certs directory
        const certsDir = path.join(setupLocation, "certs");
        await fs.mkdir(certsDir, { recursive: true });

        // Create traefik-logs directory
        const traefikLogsDir = path.join(setupLocation, "traefik-logs");
        await fs.mkdir(traefikLogsDir, { recursive: true });

        // Copy docker-compose.yml
        const dockerComposeContent = await fs.readFile(
          path.join(process.cwd(), "docker-compose.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(setupLocation, "docker-compose.yml"),
          dockerComposeContent
        );

        // Create .env file with proper configuration
        const envContent = `# DDALAB Docker Deployment Configuration
# This file configures DDALAB to use Docker Hub images

# Use Docker Hub images instead of building locally
DDALAB_WEB_IMAGE=sdraeger1/ddalab-web:latest
DDALAB_API_IMAGE=sdraeger1/ddalab-api:latest

# Database Configuration
DDALAB_DB_USER=admin
DDALAB_DB_PASSWORD=AdminPassword123
DDALAB_DB_NAME=postgres

# MinIO Configuration
MINIO_ROOT_USER=ddalab
MINIO_ROOT_PASSWORD=AdminPassword123

# Redis Configuration (optional)
DDALAB_REDIS_PASSWORD=
DDALAB_REDIS_USE_SSL=False

# Data Directory (where your EDF files will be stored)
DDALAB_DATA_DIR=./data

# Web Application Port
WEB_PORT=3000

# Session Configuration
SESSION_EXPIRATION=10080

# Traefik Configuration
TRAEFIK_ACME_EMAIL=admin@ddalab.local
TRAEFIK_PASSWORD_HASH=

# Cache Configuration
DDALAB_PLOT_CACHE_TTL=3600

# Allowed Directories for API access
DDALAB_ALLOWED_DIRS=${dataLocation}:/app/data:rw

# Grafana Configuration (optional)
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin

# Next.js Environment Variables
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_APP_URL=http://localhost:3000
`;
        await fs.writeFile(path.join(setupLocation, ".env"), envContent);

        // Copy traefik.yml
        const traefikContent = await fs.readFile(
          path.join(process.cwd(), "traefik.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(setupLocation, "traefik.yml"),
          traefikContent
        );

        // Copy dynamic configuration
        const dynamicContent = await fs.readFile(
          path.join(process.cwd(), "dynamic/routers.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(dynamicDir, "routers.yml"),
          dynamicContent
        );

        // Create empty acme.json file
        await fs.writeFile(path.join(setupLocation, "acme.json"), "{}");

        // Mark setup as complete
        await SetupService.saveConfigManagerState(setupLocation, setupLocation);

        logger.info("Docker deployment setup completed successfully");
        return {
          success: true,
          message: "Docker deployment setup completed successfully",
          setupPath: setupLocation,
        };
      } catch (error: any) {
        logger.error("Docker deployment setup failed:", error);
        return {
          success: false,
          message: `Docker deployment setup failed: ${error.message}`,
        };
      }
    }
  );

  // Legacy method for backward compatibility
  ipcMain.handle(
    "setup-docker-directory-legacy",
    async (event, targetDirectory: string) => {
      try {
        logger.info(
          `Setting up Docker directory (legacy) at: ${targetDirectory}`
        );

        // Create setup directory if it doesn't exist
        await fs.mkdir(targetDirectory, { recursive: true });

        // Create data directory
        const dataDir = path.join(targetDirectory, "data");
        await fs.mkdir(dataDir, { recursive: true });

        // Create dynamic directory for Traefik
        const dynamicDir = path.join(targetDirectory, "dynamic");
        await fs.mkdir(dynamicDir, { recursive: true });

        // Create certs directory
        const certsDir = path.join(targetDirectory, "certs");
        await fs.mkdir(certsDir, { recursive: true });

        // Create traefik-logs directory
        const traefikLogsDir = path.join(targetDirectory, "traefik-logs");
        await fs.mkdir(traefikLogsDir, { recursive: true });

        // Copy docker-compose.yml
        const dockerComposeContent = await fs.readFile(
          path.join(process.cwd(), "docker-compose.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(targetDirectory, "docker-compose.yml"),
          dockerComposeContent
        );

        // Create .env file with proper configuration
        const envContent = `# DDALAB Docker Deployment Configuration
# This file configures DDALAB to use Docker Hub images

# Use Docker Hub images instead of building locally
DDALAB_WEB_IMAGE=sdraeger1/ddalab-web:latest
DDALAB_API_IMAGE=sdraeger1/ddalab-api:latest

# Database Configuration
DDALAB_DB_USER=admin
DDALAB_DB_PASSWORD=AdminPassword123
DDALAB_DB_NAME=postgres

# MinIO Configuration
MINIO_ROOT_USER=ddalab
MINIO_ROOT_PASSWORD=AdminPassword123

# Redis Configuration (optional)
DDALAB_REDIS_PASSWORD=
DDALAB_REDIS_USE_SSL=False

# Data Directory (where your EDF files will be stored)
DDALAB_DATA_DIR=./data

# Web Application Port
WEB_PORT=3000

# Session Configuration
SESSION_EXPIRATION=10080

# Traefik Configuration
TRAEFIK_ACME_EMAIL=admin@ddalab.local
TRAEFIK_PASSWORD_HASH=

# Cache Configuration
DDALAB_PLOT_CACHE_TTL=3600

# Allowed Directories for API access
DDALAB_ALLOWED_DIRS=./data:/app/data:rw

# Grafana Configuration (optional)
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin

# Next.js Environment Variables
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_APP_URL=http://localhost:3000
`;
        await fs.writeFile(path.join(targetDirectory, ".env"), envContent);

        const traefikContent = await fs.readFile(
          path.join(process.cwd(), "traefik.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(targetDirectory, "traefik.yml"),
          traefikContent
        );

        const dynamicContent = await fs.readFile(
          path.join(process.cwd(), "dynamic/routers.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(dynamicDir, "routers.yml"),
          dynamicContent
        );

        // Create empty acme.json file
        await fs.writeFile(path.join(targetDirectory, "acme.json"), "{}");

        logger.info("Docker directory setup completed successfully");
        return {
          success: true,
          message: "Docker directory setup completed successfully",
          setupPath: targetDirectory,
        };
      } catch (error: any) {
        logger.error("Docker directory setup failed:", error);
        return {
          success: false,
          message: `Docker directory setup failed: ${error.message}`,
        };
      }
    }
  );
}
