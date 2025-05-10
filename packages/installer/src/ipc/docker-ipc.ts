import { ipcMain } from "electron";
import {
  manageDockerCompose,
  getIsDockerRunning,
  fetchCurrentDockerLogs,
} from "../docker-service";
import { getMainWindow } from "../utils/window-manager";

export function registerDockerIpcHandlers(): void {
  ipcMain.handle("docker-compose-up", async () => {
    const mainWindow = getMainWindow();
    return manageDockerCompose("up", mainWindow);
  });

  ipcMain.handle(
    "docker-compose-down",
    async (event, deleteVolumes?: boolean) => {
      const mainWindow = getMainWindow();
      return manageDockerCompose("down", mainWindow, deleteVolumes);
    }
  );

  ipcMain.handle("get-docker-status", () => {
    return getIsDockerRunning();
  });

  ipcMain.handle("get-docker-logs", async () => {
    return fetchCurrentDockerLogs();
  });
}
