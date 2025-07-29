import { ipcMain } from "electron";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";
import {
  SetupService,
  SetupResult,
  UserConfiguration,
} from "../services/setup-service";

export function registerEnhancedSetupIpcHandlers() {
  logger.info("Registering enhanced setup IPC handlers...");

  // Enhanced setup with full user configuration
  ipcMain.handle(
    "setup-ddalab-enhanced",
    async (
      event,
      targetDirectory: string,
      userConfig: UserConfiguration
    ): Promise<SetupResult> => {
      logger.info('IPC event "setup-ddalab-enhanced" received.', {
        targetDirectory,
        userConfig,
      });

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        logger.error("Cannot run enhanced setup: mainWindow not set.");
        return { success: false, message: "Main window not available." };
      }

      try {
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
          mainWindow.webContents.send("setup-progress", {
            message: "DDALAB enhanced setup completed successfully!",
            type: "success",
          });
          mainWindow.webContents.send(
            "setup-finished",
            await SetupService.getConfigManagerState()
          );
        }

        return result;
      } catch (error: any) {
        logger.error(`Error during enhanced setup:`, error);
        mainWindow.webContents.send("setup-progress", {
          message: `Enhanced setup failed: ${error.message}`,
          type: "error",
        });
        return {
          success: false,
          message: `Enhanced setup failed: ${error.message}`,
        };
      }
    }
  );

  // Validate user configuration
  ipcMain.handle(
    "validate-user-configuration",
    async (
      event,
      userConfig: UserConfiguration
    ): Promise<{ valid: boolean; errors: string[] }> => {
      logger.info(
        'IPC event "validate-user-configuration" received.',
        userConfig
      );

      const errors: string[] = [];

      // Validate required fields
      if (!userConfig.dataLocation) {
        errors.push("Data location is required");
      }

      if (!userConfig.allowedDirs) {
        errors.push("Allowed directories configuration is required");
      }

      // Validate data location exists or can be created
      if (userConfig.dataLocation) {
        try {
          await fs.access(userConfig.dataLocation);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            // Try to create the directory
            try {
              await fs.mkdir(userConfig.dataLocation, { recursive: true });
            } catch (mkdirError: any) {
              errors.push(`Cannot create data location: ${mkdirError.message}`);
            }
          } else {
            errors.push(`Data location is not accessible: ${error.message}`);
          }
        }
      }

      // Validate allowed directories format
      if (userConfig.allowedDirs) {
        const dirs = userConfig.allowedDirs.split(",");
        for (const dir of dirs) {
          const parts = dir.trim().split(":");
          if (parts.length !== 3) {
            errors.push(
              `Invalid allowed directory format: ${dir}. Expected format: HOST_PATH:CONTAINER_PATH:PERMISSION`
            );
          }
        }
      }

      // Validate ports
      if (userConfig.webPort) {
        const port = parseInt(userConfig.webPort);
        if (isNaN(port) || port < 1 || port > 65535) {
          errors.push("Web port must be a valid port number (1-65535)");
        }
      }

      if (userConfig.apiPort) {
        const port = parseInt(userConfig.apiPort);
        if (isNaN(port) || port < 1 || port > 65535) {
          errors.push("API port must be a valid port number (1-65535)");
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    }
  );

  // Generate default user configuration
  ipcMain.handle(
    "generate-default-user-config",
    async (event, dataLocation: string): Promise<UserConfiguration> => {
      logger.info('IPC event "generate-default-user-config" received.', {
        dataLocation,
      });

      const defaultConfig: UserConfiguration = {
        dataLocation,
        allowedDirs: `${dataLocation}:/app/data:rw`,
        webPort: "3000",
        apiPort: "8001",
        dbPassword: "ddalab_password",
        minioPassword: "ddalab_password",
        traefikEmail: "admin@ddalab.local",
        useDockerHub: true,
      };

      return defaultConfig;
    }
  );

  // Test setup without actually creating files
  ipcMain.handle(
    "test-setup-configuration",
    async (
      event,
      targetDirectory: string,
      userConfig: UserConfiguration
    ): Promise<SetupResult> => {
      logger.info('IPC event "test-setup-configuration" received.', {
        targetDirectory,
        userConfig,
      });

      try {
        // Validate the configuration
        const validation = await this.validateUserConfiguration(userConfig);
        if (!validation.valid) {
          return {
            success: false,
            message: `Configuration validation failed: ${validation.errors.join(
              ", "
            )}`,
          };
        }

        // Check if target directory is writable
        try {
          await fs.access(targetDirectory);
        } catch (error: any) {
          if (error.code === "ENOENT") {
            // Try to create the directory
            await fs.mkdir(targetDirectory, { recursive: true });
          } else {
            return {
              success: false,
              message: `Target directory is not accessible: ${error.message}`,
            };
          }
        }

        return {
          success: true,
          message: "Configuration test passed. Setup is ready to proceed.",
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Configuration test failed: ${error.message}`,
        };
      }
    }
  );

  // Get setup repository information
  ipcMain.handle(
    "get-setup-repository-info",
    async (event): Promise<{ url: string; description: string }> => {
      return {
        url: "https://github.com/sdraeger/DDALAB-setup.git",
        description:
          "DDALAB Setup Repository - Contains Docker configuration files and templates",
      };
    }
  );

  logger.info("Enhanced setup IPC handlers registered");
}
