import { ipcMain } from "electron";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { SetupService } from "../services/setup-service";

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

      // Check for docker-compose.simple.yml
      const dockerComposePath = path.join(
        setupPath,
        "docker-compose.simple.yml"
      );
      const envPath = path.join(setupPath, ".env");

      try {
        await fs.access(dockerComposePath);
        await fs.access(envPath);

        logger.info("Docker setup validation successful");
        return {
          success: true,
          message: "Docker setup is valid",
          setupPath,
        };
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

  // Setup Docker deployment
  ipcMain.handle(
    "setup-docker-deployment",
    async (event, dataLocation: string, setupLocation: string) => {
      try {
        logger.info(`Setting up Docker deployment at: ${setupLocation}`);

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

        // Copy docker-compose.simple.yml
        const dockerComposeContent = await fs.readFile(
          path.join(process.cwd(), "docker-compose.simple.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(setupLocation, "docker-compose.yml"),
          dockerComposeContent
        );

        // Copy .env.simple to .env
        const envContent = await fs.readFile(
          path.join(process.cwd(), ".env.simple"),
          "utf-8"
        );
        await fs.writeFile(path.join(setupLocation, ".env"), envContent);

        // Copy traefik.simple.yml
        const traefikContent = await fs.readFile(
          path.join(process.cwd(), "traefik.simple.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(setupLocation, "traefik.yml"),
          traefikContent
        );

        // Copy dynamic configuration
        const dynamicContent = await fs.readFile(
          path.join(process.cwd(), "dynamic/routers.simple.yml"),
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
      } catch (error) {
        logger.error("Docker deployment setup failed:", error);
        return {
          success: false,
          message: `Setup failed: ${String(error)}`,
        };
      }
    }
  );

  // Setup Docker directory
  ipcMain.handle(
    "setup-docker-directory",
    async (event, targetDirectory: string) => {
      try {
        logger.info(`Setting up Docker directory at: ${targetDirectory}`);

        // Create the directory if it doesn't exist
        await fs.mkdir(targetDirectory, { recursive: true });

        // Create subdirectories
        const dataDir = path.join(targetDirectory, "data");
        const dynamicDir = path.join(targetDirectory, "dynamic");
        const certsDir = path.join(targetDirectory, "certs");
        const traefikLogsDir = path.join(targetDirectory, "traefik-logs");

        await fs.mkdir(dataDir, { recursive: true });
        await fs.mkdir(dynamicDir, { recursive: true });
        await fs.mkdir(certsDir, { recursive: true });
        await fs.mkdir(traefikLogsDir, { recursive: true });

        // Copy configuration files
        const dockerComposeContent = await fs.readFile(
          path.join(process.cwd(), "docker-compose.simple.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(targetDirectory, "docker-compose.yml"),
          dockerComposeContent
        );

        const envContent = await fs.readFile(
          path.join(process.cwd(), ".env.simple"),
          "utf-8"
        );
        await fs.writeFile(path.join(targetDirectory, ".env"), envContent);

        const traefikContent = await fs.readFile(
          path.join(process.cwd(), "traefik.simple.yml"),
          "utf-8"
        );
        await fs.writeFile(
          path.join(targetDirectory, "traefik.yml"),
          traefikContent
        );

        const dynamicContent = await fs.readFile(
          path.join(process.cwd(), "dynamic/routers.simple.yml"),
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
      } catch (error) {
        logger.error("Docker directory setup failed:", error);
        return {
          success: false,
          message: `Setup failed: ${String(error)}`,
        };
      }
    }
  );
}
