import { ipcMain, dialog, app } from "electron";
import { getMainWindow } from "../utils/window-manager";
import { SetupService } from "../services/setup-service";
import { SystemTrayService } from "../services/system-tray-service";
import type { UserSelections, ParsedEnvEntry } from "../utils/electron";
import { logger } from "../utils/logger";
import { TestMocks, getTestEnvironmentConfig } from "../../tests/setup/electron-main-mocks";

export function registerConfigManagerIpcHandlers(): void {
  ipcMain.handle(
    "configmanager:select-directory",
    async (): Promise<string | undefined> => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return undefined;
      
      // Check if we're in test mode and should use mock dialog
      const testConfig = getTestEnvironmentConfig();
      if (testConfig.isTestMode) {
        const mockResult = TestMocks.showDirectoryDialog();
        if (mockResult) {
          logger.info("Using mock directory selection", { path: mockResult.filePaths[0] });
          return mockResult.canceled ? undefined : mockResult.filePaths[0];
        }
      }
      
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "showHiddenFiles"],
      });
      if (canceled || filePaths.length === 0) {
        return undefined;
      }
      logger.info("Selected directory", { path: filePaths[0] });
      return filePaths[0];
    }
  );

  ipcMain.handle("configmanager:get-state", async (): Promise<any> => {
    return await SetupService.getConfigManagerState();
  });

  ipcMain.handle(
    "configmanager:save-user-state",
    async (
      event,
      userSelections: UserSelections,
      currentSite: string,
      parsedEnvEntries: ParsedEnvEntry[],
      installationSuccess: boolean | null
    ): Promise<void> => {
      await SetupService.saveUserState(
        userSelections,
        currentSite,
        parsedEnvEntries,
        installationSuccess
      );
    }
  );

  ipcMain.handle(
    "configmanager:save-full-state",
    async (
      event,
      setupPathOrDataLocation: string | null,
      projectLocation: string | null,
      userSelections: UserSelections,
      currentSite: string,
      parsedEnvEntries: ParsedEnvEntry[],
      installationSuccess: boolean | null
    ): Promise<void> => {
      await SetupService.saveFullApplicationState(
        setupPathOrDataLocation,
        projectLocation,
        userSelections,
        currentSite,
        parsedEnvEntries,
        installationSuccess
      );
    }
  );

  ipcMain.on("configmanager:quit-app", () => {
    app.quit();
  });

  // Quit confirmation handlers
  ipcMain.handle("app:confirmQuit", async () => {
    // Set the quitting flag so the before-quit handler knows to proceed
    SystemTrayService.setIsQuitting(true);

    // Clean up and quit the app
    SystemTrayService.destroy();
    app.quit();
  });
}
