import { app, BrowserWindow } from "electron";
import { createWindow } from "./window-manager";
import { stopLogStream as stopDockerLogStream } from "../services/docker-service";

export function initializeAppLifecycle(): void {
  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    stopDockerLogStream();
  });
}
