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
DDALAB_IMAGE=sdraeger1/ddalab:latest

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
NEXT_PUBLIC_API_URL=https://localhost
NEXT_PUBLIC_APP_URL=https://localhost
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
        logger.info(`Creating target directory: ${targetDirectory}`);
        await fs.mkdir(targetDirectory, { recursive: true });
        
        // Verify directory was created
        const dirStat = await fs.stat(targetDirectory);
        if (!dirStat.isDirectory()) {
          throw new Error(`Failed to create directory: ${targetDirectory}`);
        }
        logger.info(`Directory created successfully: ${targetDirectory}`);

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

        // Create or copy docker-compose.yml
        const targetPath = path.join(targetDirectory, "docker-compose.yml");
        logger.info(`Creating docker-compose.yml at ${targetPath}`);
        
        // First try to copy from the parent DDALAB directory
        const possibleSources = [
          path.join(process.cwd(), "docker-compose.yml"),
          path.join(process.cwd(), "..", "..", "docker-compose.yml"), // From packages/configmanager to root
          path.join(process.cwd(), "..", "..", "..", "docker-compose.yml"), // Alternative path
        ];
        
        let dockerComposeContent = null;
        for (const sourcePath of possibleSources) {
          try {
            logger.info(`Trying to copy docker-compose.yml from ${sourcePath}`);
            dockerComposeContent = await fs.readFile(sourcePath, "utf-8");
            logger.info(`Successfully found docker-compose.yml at ${sourcePath}`);
            break;
          } catch (error) {
            logger.warn(`Could not read docker-compose.yml from ${sourcePath}: ${error.message}`);
          }
        }
        
        // If we couldn't find the template, create a minimal working version
        if (!dockerComposeContent) {
          logger.info("Creating minimal docker-compose.yml template");
          dockerComposeContent = `version: '3.8'

services:
  ddalab:
    image: sdraeger1/ddalab:latest
    container_name: ddalab
    ports:
      - "8000:8000"
    environment:
      - DDALAB_DB_HOST=postgres
      - DDALAB_DB_USER=\${DDALAB_DB_USER}
      - DDALAB_DB_PASSWORD=\${DDALAB_DB_PASSWORD}
      - DDALAB_DB_NAME=\${DDALAB_DB_NAME}
      - DDALAB_ALLOWED_DIRS=\${DDALAB_ALLOWED_DIRS}
      - DDALAB_DATA_DIR=\${DDALAB_DATA_DIR}
    volumes:
      - ./data:/app/data
    depends_on:
      - postgres
      - redis
      - minio
    networks:
      - ddalab-network

  postgres:
    image: postgres:15
    container_name: ddalab-postgres
    environment:
      - POSTGRES_USER=\${DDALAB_DB_USER}
      - POSTGRES_PASSWORD=\${DDALAB_DB_PASSWORD}
      - POSTGRES_DB=\${DDALAB_DB_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - ddalab-network

  redis:
    image: redis:alpine
    container_name: ddalab-redis
    networks:
      - ddalab-network

  minio:
    image: minio/minio
    container_name: ddalab-minio
    environment:
      - MINIO_ROOT_USER=\${MINIO_ROOT_USER}
      - MINIO_ROOT_PASSWORD=\${MINIO_ROOT_PASSWORD}
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    networks:
      - ddalab-network

  web:
    image: sdraeger1/ddalab-web:latest
    container_name: ddalab-web
    ports:
      - "\${WEB_PORT}:3000"
    environment:
      - NEXT_PUBLIC_API_URL=\${NEXT_PUBLIC_API_URL}
      - NEXT_PUBLIC_APP_URL=\${NEXT_PUBLIC_APP_URL}
    depends_on:
      - ddalab
    networks:
      - ddalab-network

volumes:
  postgres_data:
  minio_data:

networks:
  ddalab-network:
    driver: bridge
`;
        }
        
        await fs.writeFile(targetPath, dockerComposeContent);
        logger.info(`docker-compose.yml created successfully at ${targetPath}`);

        // Create .env file with proper configuration
        const envContent = `# DDALAB Docker Deployment Configuration
# This file configures DDALAB to use Docker Hub images

# Use Docker Hub images instead of building locally
DDALAB_IMAGE=sdraeger1/ddalab:latest

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
NEXT_PUBLIC_API_URL=https://localhost
NEXT_PUBLIC_APP_URL=https://localhost
`;
        await fs.writeFile(path.join(targetDirectory, ".env"), envContent);

        // Create or copy traefik.yml
        const traefikPath = path.join(targetDirectory, "traefik.yml");
        logger.info(`Creating traefik.yml at ${traefikPath}`);
        
        const possibleTraefikSources = [
          path.join(process.cwd(), "traefik.yml"),
          path.join(process.cwd(), "..", "..", "traefik.yml"),
          path.join(process.cwd(), "..", "..", "..", "traefik.yml"),
        ];
        
        let traefikContent = null;
        for (const sourcePath of possibleTraefikSources) {
          try {
            logger.info(`Trying to copy traefik.yml from ${sourcePath}`);
            traefikContent = await fs.readFile(sourcePath, "utf-8");
            logger.info(`Successfully found traefik.yml at ${sourcePath}`);
            break;
          } catch (error) {
            logger.warn(`Could not read traefik.yml from ${sourcePath}: ${error.message}`);
          }
        }
        
        // If we couldn't find the template, create a minimal working version
        if (!traefikContent) {
          logger.info("Creating minimal traefik.yml template");
          traefikContent = `api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
  file:
    directory: /dynamic
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@ddalab.local
      storage: acme.json
      httpChallenge:
        entryPoint: web

log:
  level: INFO
  filePath: "/traefik-logs/traefik.log"

accessLog:
  filePath: "/traefik-logs/access.log"
`;
        }
        
        await fs.writeFile(traefikPath, traefikContent);
        logger.info(`traefik.yml created successfully at ${traefikPath}`);

        // Create or copy dynamic router configuration
        const routersPath = path.join(dynamicDir, "routers.yml");
        logger.info(`Creating routers.yml at ${routersPath}`);
        
        const possibleDynamicSources = [
          path.join(process.cwd(), "dynamic/routers.yml"),
          path.join(process.cwd(), "..", "..", "dynamic/routers.yml"),
          path.join(process.cwd(), "..", "..", "..", "dynamic/routers.yml"),
        ];
        
        let dynamicContent = null;
        for (const sourcePath of possibleDynamicSources) {
          try {
            logger.info(`Trying to copy routers.yml from ${sourcePath}`);
            dynamicContent = await fs.readFile(sourcePath, "utf-8");
            logger.info(`Successfully found routers.yml at ${sourcePath}`);
            break;
          } catch (error) {
            logger.warn(`Could not read routers.yml from ${sourcePath}: ${error.message}`);
          }
        }
        
        // If we couldn't find the template, create a minimal working version
        if (!dynamicContent) {
          logger.info("Creating minimal routers.yml template");
          dynamicContent = `http:
  routers:
    ddalab-api:
      rule: "Host(\`localhost\`) && PathPrefix(\`/api\`)"
      service: ddalab-api
      tls: {}
    
    ddalab-web:
      rule: "Host(\`localhost\`)"
      service: ddalab-web
      tls: {}

  services:
    ddalab-api:
      loadBalancer:
        servers:
          - url: "http://ddalab:8000"
    
    ddalab-web:
      loadBalancer:
        servers:
          - url: "http://web:3000"

tls:
  certificates:
    - certFile: /certs/server.crt
      keyFile: /certs/server.key
`;
        }
        
        await fs.writeFile(routersPath, dynamicContent);
        logger.info(`routers.yml created successfully at ${routersPath}`);

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
