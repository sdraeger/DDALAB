import { ipcMain, dialog, IpcMainInvokeEvent } from "electron";
import { getMainWindow } from "../utils/window-manager";

export function registerDialogIpcHandlers(): void {
  ipcMain.handle("dialog:openFile", async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
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
      const mainWindow = getMainWindow();
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
}
