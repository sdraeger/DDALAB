import { BrowserWindow } from "electron";
import { logger } from "./logger";
import { SetupService } from "../services/setup-service";

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindow(win: BrowserWindow) {
  logger.info(`setMainWindow called with window ID: ${win.id}`);
  mainWindow = win;

  win.webContents.on("before-input-event", (event, input) => {
    if (
      (input.meta && input.alt && input.key.toLowerCase() === "i") ||
      (input.control && input.shift && input.key.toLowerCase() === "i")
    ) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  SetupService.getConfigManagerState()
    .then((state) => {
      mainWindow?.webContents.send("configmanager-state-loaded", state);
    })
    .catch((err) => {
      logger.error(`Error sending initial state to renderer:`, err);
      mainWindow?.webContents.send("configmanager-state-loaded", {
        setupComplete: false,
        setupPath: null,
        error: true,
      });
    });
}
