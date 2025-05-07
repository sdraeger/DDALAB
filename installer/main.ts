import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  IpcMainInvokeEvent,
} from "electron";
import path from "path";
import fs from "fs";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Define the target .env file path in a central location
// This path points to the parent directory of the app (e.g., DDALAB/.env)
// export const USER_ENV_FILE_PATH = path.join(app.getAppPath(), "..", ".env");
const USER_ENV_FILE_PATH = path.join(app.getAppPath(), "..", ".env");

// Define the interface for parsed .env entries with comments
interface ParsedEnvEntry {
  key: string;
  value: string;
  comments: string[]; // Array of comment lines preceding the key-value pair
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // Critical: This path will be relative to dist/main.js at runtime
      // So, it should point to dist/preload.js
      // __dirname in dist/main.js will be electron-app/dist/
      // path.join(__dirname, 'preload.js') would look for electron-app/dist/preload.js - This is correct.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "src/installer.html")); // NEW: Expects installer.html to be in dist/src/installer.html relative to dist/main.js

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open DevTools - uncomment if needed
  // if (process.env.NODE_ENV !== "production") {
  //   mainWindow.webContents.openDevTools();
  // }
}

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

// IPC Handlers with typing
ipcMain.handle("dialog:openFile", async (): Promise<string | null> => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "showHiddenFiles"],
    filters: [
      {
        name: "Env Files",
        extensions: [
          "env",
          "txt",
          "vars",
          "test",
          "local",
          "development",
          "production",
          "staging",
          "example",
          "sample",
          "template",
          "",
        ],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  return filePaths[0];
});

ipcMain.handle(
  "dialog:saveFile",
  async (
    event: IpcMainInvokeEvent,
    defaultPath?: string
  ): Promise<string | null> => {
    if (!mainWindow) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath || "my.env",
      filters: [
        {
          name: "Env Files",
          extensions: [
            "env",
            "txt",
            "vars",
            "test",
            "local",
            "development",
            "production",
            "staging",
            "example",
            "sample",
            "template",
            "",
          ],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (canceled || !filePath) {
      return null;
    }
    return filePath;
  }
);

ipcMain.handle(
  "fs:readFile",
  async (
    event: IpcMainInvokeEvent,
    filePath: string
  ): Promise<string | { error: string }> => {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return content;
    } catch (error: any) {
      console.error("Failed to read file:", filePath, error);
      return { error: error.message || "Unknown error" };
    }
  }
);

ipcMain.handle(
  "fs:writeFile",
  async (
    event: IpcMainInvokeEvent,
    filePath: string,
    content: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await fs.promises.writeFile(filePath, content, "utf-8");
      return { success: true };
    } catch (error: any) {
      console.error("Failed to write file:", filePath, error);
      return { success: false, error: error.message || "Unknown error" };
    }
  }
);

ipcMain.handle(
  "fs:checkPath",
  async (
    event: IpcMainInvokeEvent,
    filePath: string
  ): Promise<{
    exists: boolean;
    isFile: boolean;
    isDirectory: boolean;
    message: string;
  }> => {
    try {
      if (!filePath || filePath.trim() === "") {
        return {
          exists: false,
          isFile: false,
          isDirectory: false,
          message: "Path is empty",
        };
      }
      const stats = await fs.promises.stat(filePath);
      if (stats.isFile()) {
        return {
          exists: true,
          isFile: true,
          isDirectory: false,
          message: "File found",
        };
      }
      if (stats.isDirectory()) {
        return {
          exists: true,
          isFile: false,
          isDirectory: true,
          message: "Path is a directory",
        };
      }
      return {
        exists: true,
        isFile: false,
        isDirectory: false,
        message: "Path exists but is not a regular file or directory",
      };
    } catch (error: any) {
      let message = `Error checking path: ${error.code || error.message}`;
      if (error.code === "ENOENT") message = "File or directory not found";
      else if (error.code === "EACCES") message = "Permission denied";
      else if (error.code === "ENOTDIR")
        message = "A part of the path is not a directory";
      else console.error("Failed to check path:", filePath, error);
      return { exists: false, isFile: false, isDirectory: false, message };
    }
  }
);

// New IPC Handlers for Installer

ipcMain.handle(
  "installer:select-directory",
  async (): Promise<string | undefined> => {
    if (!mainWindow) return undefined;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "showHiddenFiles"],
    });
    if (canceled || filePaths.length === 0) {
      return undefined;
    }
    return filePaths[0];
  }
);

ipcMain.handle(
  "installer:get-env-example-content",
  async (): Promise<string | undefined> => {
    try {
      console.log(`Attempting to read env file from: ${USER_ENV_FILE_PATH}`);
      if (fs.existsSync(USER_ENV_FILE_PATH)) {
        const content = await fs.promises.readFile(USER_ENV_FILE_PATH, "utf-8");
        return content;
      }
      console.warn(
        `Env file not found at expected location: ${USER_ENV_FILE_PATH}`
      );
      return undefined;
    } catch (error: any) {
      console.error(
        `Failed to read env file from ${USER_ENV_FILE_PATH}:`,
        error
      );
      return undefined;
    }
  }
);

// New IPC Handler to parse .env.example with comments
ipcMain.handle(
  "installer:parse-env-example-with-comments",
  async (): Promise<ParsedEnvEntry[] | undefined> => {
    try {
      if (!fs.existsSync(USER_ENV_FILE_PATH)) {
        return undefined;
      }
      const content = await fs.promises.readFile(USER_ENV_FILE_PATH, "utf-8");
      const lines = content.split(/\r?\n/); // Split by new line

      const entries: ParsedEnvEntry[] = [];
      let currentComments: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith("#")) {
          const commentText = trimmedLine.substring(1).trim();
          currentComments.push(commentText);
        } else {
          const LIKELY_ENV_LINE_WITH_EQUALS = /^\s*([\w.-]+)\s*=\s*(.*)/;
          const match = trimmedLine.match(LIKELY_ENV_LINE_WITH_EQUALS);

          if (match) {
            const key = match[1];
            const value = match[2].trim();
            entries.push({ key, value, comments: currentComments });
            currentComments = []; // Reset comments for the next variable
          } else {
            currentComments = []; // Reset comments as they don't belong to a var here
          }
        }
      }

      return entries;
    } catch (error: any) {
      return undefined;
    }
  }
);

ipcMain.on("installer:save-env-config", (event, content: string): void => {
  try {
    console.log(`Attempting to save .env to: ${USER_ENV_FILE_PATH}`);
    fs.writeFileSync(USER_ENV_FILE_PATH, content, "utf-8");
    console.log(".env file saved successfully.");
    // Optionally, send a success reply to renderer
    // event.reply('installer:save-env-config-success');
  } catch (error: any) {
    console.error("Failed to save .env file:", error);
    // Optionally, send an error reply to renderer
    // event.reply('installer:save-env-config-error', error.message);
  }
});

ipcMain.on("installer:quit-app", () => {
  app.quit();
});

let isDockerRunning = false;
let logProcess: ReturnType<typeof spawn> | null = null;

async function runDockerCompose(command: "up" | "down"): Promise<boolean> {
  try {
    const { stdout, stderr } = await execAsync(
      `docker compose ${command}${command === "up" ? " -d" : ""}`.trim(),
      {
        cwd: app.getAppPath(),
      }
    );

    console.log(`Docker Compose ${command} stdout:`, stdout);
    if (stderr) console.error(`Docker Compose ${command} stderr:`, stderr);

    isDockerRunning = command === "up";

    // If starting up, begin streaming logs
    if (command === "up" && mainWindow) {
      streamDockerLogs();
    } else if (command === "down") {
      stopLogStream();
    }

    return true;
  } catch (error) {
    console.error(`Error running docker-compose ${command}:`, error);
    return false;
  }
}

function streamDockerLogs() {
  if (logProcess) {
    stopLogStream();
  }

  logProcess = spawn("docker", ["compose", "logs", "--follow"], {
    cwd: app.getAppPath(),
  });

  logProcess.stdout?.on("data", (data) => {
    const logData = data.toString();
    if (mainWindow) {
      mainWindow.webContents.send("docker-logs", {
        type: "stdout",
        data: logData,
      });
    }
  });

  logProcess.stderr?.on("data", (data) => {
    const logData = data.toString();
    if (mainWindow) {
      mainWindow.webContents.send("docker-logs", {
        type: "stderr",
        data: logData,
      });
    }
  });

  logProcess.on("error", (error) => {
    console.error("Error in log process:", error);
    if (mainWindow) {
      mainWindow.webContents.send("docker-logs", {
        type: "error",
        data: error.message,
      });
    }
  });
}

function stopLogStream() {
  if (logProcess) {
    logProcess.kill();
    logProcess = null;
  }
}

// Add these IPC handlers
ipcMain.handle("docker-compose-up", async () => {
  return runDockerCompose("up");
});

ipcMain.handle("docker-compose-down", async () => {
  return runDockerCompose("down");
});

ipcMain.handle("get-docker-status", () => {
  return isDockerRunning;
});

// New handler to get current logs
ipcMain.handle("get-docker-logs", async () => {
  try {
    const { stdout } = await execAsync("docker compose logs --tail=50", {
      cwd: app.getAppPath(),
    });
    return stdout;
  } catch (error) {
    console.error("Error getting docker logs:", error);
    return "";
  }
});

// Clean up when app is closing
app.on("before-quit", () => {
  stopLogStream();
});
