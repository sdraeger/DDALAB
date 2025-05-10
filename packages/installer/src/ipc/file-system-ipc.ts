import { ipcMain, IpcMainInvokeEvent } from "electron";
import fs from "fs";

export function registerFileSystemIpcHandlers(): void {
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
        console.error("[fs-ipc] Failed to read file:", filePath, error);
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
        console.error("[fs-ipc] Failed to write file:", filePath, error);
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
        let message = `[fs-ipc] Error checking path: ${
          error.code || error.message
        }`;
        if (error.code === "ENOENT") message = "File or directory not found";
        else if (error.code === "EACCES") message = "Permission denied";
        else if (error.code === "ENOTDIR")
          message = "A part of the path is not a directory";
        else console.error("[fs-ipc] Failed to check path:", filePath, error);
        return { exists: false, isFile: false, isDirectory: false, message };
      }
    }
  );
}
