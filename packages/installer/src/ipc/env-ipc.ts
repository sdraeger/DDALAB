import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  loadEnvVars,
  saveEnvConfig,
  saveEnvFile,
  ParsedEnvEntry,
} from "../utils/env-manager";

export function registerEnvIpcHandlers(): void {
  ipcMain.handle(
    "installer:load-env-vars",
    async (
      event: IpcMainInvokeEvent,
      dataDir?: string
    ): Promise<ParsedEnvEntry[] | undefined> => {
      return loadEnvVars(dataDir);
    }
  );

  ipcMain.on(
    "installer:save-env-config",
    (event, targetDirOrSignal: string | null, content: string): void => {
      saveEnvConfig(targetDirOrSignal, content);
    }
  );

  ipcMain.handle(
    "save-env-file",
    async (
      event: IpcMainInvokeEvent,
      envPath: string,
      envData: Record<string, string>
    ): Promise<void> => {
      return saveEnvFile(envPath, envData);
    }
  );
}
