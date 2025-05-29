import { app } from "electron";
import { initializeAppLifecycle } from "./utils/app-lifecycle";
import { registerFileSystemIpcHandlers } from "./ipc/file-system-ipc";
import { registerDialogIpcHandlers } from "./ipc/dialog-ipc";
import { registerInstallerIpcHandlers } from "./ipc/installer-ipc";
import { registerEnvIpcHandlers } from "./ipc/env-ipc";
import { registerDockerIpcHandlers } from "./ipc/docker-ipc";
import { registerSetupIpcHandlers } from "./ipc/setup-ipc";
import { logger } from "./utils/logger";
import { PROJECT_ROOT_ENV_PATH } from "./utils/env-manager";

logger.info("Script execution started");
logger.info("Initializing Paths:", {
  __dirname,
  userDataPath: app.getPath("userData"),
  PROJECT_ROOT_ENV_PATH,
});

initializeAppLifecycle();
registerFileSystemIpcHandlers();
registerDialogIpcHandlers();
registerInstallerIpcHandlers();
registerEnvIpcHandlers();
registerDockerIpcHandlers();
registerSetupIpcHandlers();

export { setMainWindow } from "./utils/main-window";
