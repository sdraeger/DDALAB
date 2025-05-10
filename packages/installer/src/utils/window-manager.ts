import { BrowserWindow } from "electron";
import path from "path";
import { setMainWindow as setMainProcessMainWindow } from "../../main";

let mainWindow: BrowserWindow | null = null;

export function createWindow(): void {
  const newWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  newWindow.loadFile(path.join(__dirname, "..", "installer.html"));

  newWindow.on("closed", () => {
    if (mainWindow === newWindow) {
      mainWindow = null;
    }
  });

  console.log(
    `[window-manager.ts] In createWindow - Current NODE_ENV: ${process.env.NODE_ENV}`
  );
  // if (process.env.NODE_ENV !== "production") {
  //   newWindow.webContents.openDevTools();
  // }

  mainWindow = newWindow;
  setMainProcessMainWindow(newWindow);
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
