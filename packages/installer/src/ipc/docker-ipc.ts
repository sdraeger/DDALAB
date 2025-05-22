import { ipcMain } from "electron";
import { fetchCurrentDockerLogs } from "../services/docker-service";

export function registerDockerIpcHandlers(): void {
  ipcMain.handle("get-docker-logs", async () => {
    return fetchCurrentDockerLogs();
  });
}
