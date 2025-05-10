import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import { autoUpdater } from "electron-updater";
import Store from "electron-store";

const store = new Store();
let mainWindow: BrowserWindow | null = null;
let retryCount = 0;
const MAX_RETRIES = 5;

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

const loadDevelopmentServer = async () => {
  if (!mainWindow) return;

  try {
    console.log("Loading development server at http://localhost:3000");
    await mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
    retryCount = 0; // Reset retry count on successful connection
  } catch (error) {
    console.error("Failed to connect to development server:", error);

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(
        `Retrying in 2 seconds... (Attempt ${retryCount}/${MAX_RETRIES})`
      );
      setTimeout(loadDevelopmentServer, 2000);
    } else {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Connection Error",
        message: "Failed to connect to the development server.",
        detail:
          "Please make sure the Next.js development server is running at http://localhost:3000",
        buttons: ["Retry", "Exit"],
        defaultId: 0,
      });

      if (choice.response === 0) {
        retryCount = 0;
        await loadDevelopmentServer();
      } else {
        app.quit();
      }
    }
  }
};

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Check for updates
  autoUpdater.checkForUpdatesAndNotify();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle("store:get", async (_, key: string) => {
  return store.get(key);
});

ipcMain.handle("store:set", async (_, key: string, value: any) => {
  store.set(key, value);
});

// Handle auth-related IPC messages
ipcMain.handle(
  "auth:login",
  async (_, credentials: { email: string; password: string }) => {
    // Implement authentication logic here
    // This should connect to your authentication service
    return { success: true };
  }
);

ipcMain.handle("auth:logout", async () => {
  // Implement logout logic
  return { success: true };
});
