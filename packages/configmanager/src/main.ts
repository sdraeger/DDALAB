import { app } from "electron";
import { initializeAppLifecycle } from "./utils/app-lifecycle";
import { registerFileSystemIpcHandlers } from "./ipc/file-system-ipc";
import { registerDialogIpcHandlers } from "./ipc/dialog-ipc";
import { registerConfigManagerIpcHandlers } from "./ipc/configmanager-ipc";
import { registerEnvIpcHandlers } from "./ipc/env-ipc";
import { registerDockerIpcHandlers } from "./ipc/docker-ipc";
import { registerSetupIpcHandlers } from "./ipc/setup-ipc";
import { registerDockerDeploymentIpcHandlers } from "./ipc/docker-deployment-ipc";
import { registerEnhancedSetupIpcHandlers } from "./ipc/enhanced-setup-ipc";
import { registerDockerCheckIpcHandlers } from "./ipc/docker-check-ipc";
import { registerUpdateIpcHandlers } from "./ipc/update-ipc";
import { registerMinIOUpdateIpcHandlers } from "./ipc/minio-update-ipc";
import { registerMenuIpcHandlers } from "./ipc/menu-ipc";
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
registerConfigManagerIpcHandlers();
registerEnvIpcHandlers();
registerDockerIpcHandlers();
registerSetupIpcHandlers();
registerDockerDeploymentIpcHandlers();
registerEnhancedSetupIpcHandlers();
registerDockerCheckIpcHandlers();
registerUpdateIpcHandlers();
registerMinIOUpdateIpcHandlers();
registerMenuIpcHandlers();

export { setMainWindow } from "./utils/main-window";
