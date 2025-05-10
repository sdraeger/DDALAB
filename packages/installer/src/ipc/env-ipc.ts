import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  loadEnvVars,
  saveEnvConfig,
  ParsedEnvEntry,
} from "../utils/env-manager";

export function registerEnvIpcHandlers(): void {
  ipcMain.handle(
    "installer:load-env-vars",
    async (
      event: IpcMainInvokeEvent,
      dataDir?: string
    ): Promise<ParsedEnvEntry[] | undefined> => {
      return loadEnvVars();
    }
  );

  ipcMain.on(
    "installer:save-env-config",
    (event, targetDirOrSignal: string | null, content: string): void => {
      saveEnvConfig(targetDirOrSignal, content);
    }
  );
}
