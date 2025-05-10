import { ipcMain, dialog, app } from "electron";
import { getMainWindow } from "../utils/window-manager";

export function registerInstallerIpcHandlers(): void {
  ipcMain.handle(
    "installer:select-directory",
    async (): Promise<string | undefined> => {
      const mainWindow = getMainWindow();
      if (!mainWindow) return undefined;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "showHiddenFiles"],
      });
      if (canceled || filePaths.length === 0) {
        return undefined;
      }
      console.log(`[installer-ipc] Selected directory: ${filePaths[0]}`);
      return filePaths[0];
    }
  );

  ipcMain.on("installer:quit-app", () => {
    app.quit();
  });
}
