import { BrowserWindow, app } from "electron";
import path from "path";
import { setMainWindow as setMainProcessMainWindow } from "../main";
import { SystemTrayService } from "../services/system-tray-service";

let mainWindow: BrowserWindow | null = null;

export function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "preload.js");
  console.log("[window-manager.ts] Preload script path:", preloadPath);

  const newWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(__dirname, "src", "configmanager.html");
  console.log("[window-manager.ts] HTML file path:", htmlPath);
  newWindow.loadFile(htmlPath);

  newWindow.on("close", (event) => {
    // Check if the app is being force quit (via tray menu or Cmd+Q)
    if (SystemTrayService.getIsQuitting()) {
      // Allow the window to close normally when quitting
      return;
    }

    // Otherwise, hide the window instead of closing it
    // This keeps the app running in the system tray (Windows/Linux) or dock (macOS)
    event.preventDefault();
    newWindow.hide();
  });

  newWindow.on("closed", () => {
    if (mainWindow === newWindow) {
      mainWindow = null;
    }
  });

  console.log(
    `[window-manager.ts] In createWindow - Current NODE_ENV: ${process.env.NODE_ENV}`
  );

  mainWindow = newWindow;
  setMainProcessMainWindow(newWindow);

  return newWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
