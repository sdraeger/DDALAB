import { exec, spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";
import { SetupService, ConfigManagerState } from "./setup-service";

export class DockerService {
  private static logProcess: ChildProcess | null = null;
  private static isDockerRunning: boolean = false;

  static getDockerEnvironment() {
    const currentPath = process.env.PATH || "";
    const dockerPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/Applications/Docker.app/Contents/Resources/bin",
    ];
    return { ...process.env, PATH: [...dockerPaths, currentPath].join(":") };
  }

  static async validateDockerFiles(setupPath: string): Promise<void> {
    const requiredFiles = [
      "docker-compose.yml",
      "prometheus.yml",
      "traefik.yml",
      ".env",
      "acme.json",
    ];
    const requiredDirectories = ["dynamic", "certs"];
    logger.info(`Validating required files in ${setupPath}`);

    for (const file of requiredFiles) {
      const filePath = path.join(setupPath, file);
      await fs.access(filePath);
      logger.info(`✓ Found required file: ${file}`);
    }

    for (const dir of requiredDirectories) {
      const dirPath = path.join(setupPath, dir);
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        throw new Error(`${dir} exists but is not a directory`);
      }
      logger.info(`✓ Found required directory: ${dir}`);
    }
  }

  static async generateDockerVolumes(setupPath: string): Promise<void> {
    const envFilePath = path.join(setupPath, ".env");
    const envContent = await fs.readFile(envFilePath, "utf-8");
    const allowedDirsMatch = envContent.match(/^DDALAB_ALLOWED_DIRS=(.*)$/m);
    if (!allowedDirsMatch) {
      throw new Error("DDALAB_ALLOWED_DIRS not found in .env file");
    }

    const allowedDirs = allowedDirsMatch[1].trim();
    logger.info(`Found DDALAB_ALLOWED_DIRS: ${allowedDirs}`);

    let volumesContent = `# Auto-generated file - do not edit manually
# Generated from DDALAB_ALLOWED_DIRS: ${allowedDirs}

services:
  api:
    volumes:
      - prometheus_metrics:/tmp/prometheus
`;

    const dirs = allowedDirs.split(",");
    for (const dir of dirs) {
      const parts = dir.trim().split(":");
      if (parts.length === 3) {
        const sourcePath = parts[0];
        const targetPath = parts[1];
        const mode = parts[2];
        volumesContent += `      - type: bind\n        source: ${sourcePath}\n        target: ${targetPath}\n`;
        if (mode === "ro") {
          volumesContent += `        read_only: true\n`;
        }
      } else {
        logger.warn(`Invalid directory format: ${dir}`);
      }
    }

    const volumesFilePath = path.join(setupPath, "docker-compose.volumes.yml");
    await fs.writeFile(volumesFilePath, volumesContent, "utf-8");
    logger.info(`Generated ${volumesFilePath}`);
  }

  static async getDockerProjectName(): Promise<string> {
    const state = await SetupService.getConfigManagerState();
    if (!state.setupComplete || !state.setupPath) {
      logger.error(
        "Attempted to get Docker project name before setup is complete or setupPath is invalid."
      );
      throw new Error("Setup not complete or path missing.");
    }
    return path
      .basename(state.setupPath)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  static async getTraefikContainerId(
    projectName: string
  ): Promise<string | null> {
    const state = await SetupService.getConfigManagerState();
    if (!state.setupComplete || !state.setupPath) {
      logger.error(
        "getTraefikContainerId called before setup or without valid path."
      );
      getMainWindow()?.webContents.send("docker-status-update", {
        type: "error",
        message:
          "Cannot get Traefik ID: Setup not complete or path is missing.",
      });
      return null;
    }

    const command = `docker-compose -f docker-compose.yml -f docker-compose.volumes.yml ps -q traefik`;
    logger.info(`Executing command to get Traefik ID: ${command}`);

    return new Promise((resolve) => {
      exec(
        command,
        { cwd: state.setupPath!, env: this.getDockerEnvironment() },
        (error, stdout, stderr) => {
          if (error) {
            logger.error(
              `Error executing 'docker compose ps' for Traefik ID: ${error.message}. Stderr: ${stderr}`
            );
            getMainWindow()?.webContents.send("docker-status-update", {
              type: "error",
              message: `Failed to get Traefik ID (exec error): ${
                stderr || error.message
              }`,
            });
            resolve(null);
            return;
          }
          const containerId = stdout.trim();
          if (containerId) {
            logger.info(
              `'docker-compose ps -q traefik' stdout: '${stdout}'. Trimmed ID: '${containerId}'.`
            );
            resolve(containerId);
          } else {
            logger.error(
              `Traefik container ID not found. stdout: '${stdout}'. stderr: '${stderr}'.`
            );
            getMainWindow()?.webContents.send("docker-status-update", {
              type: "error",
              message:
                "Traefik container not found after startup (empty ps output).",
            });
            resolve(null);
          }
        }
      );
    });
  }

  static async checkTraefikHealth(
    containerId: string,
    attempt = 0
  ): Promise<void> {
    const maxAttempts = 60;
    const retryDelay = 5000;
    const mainWindow = getMainWindow();

    if (!mainWindow) {
      logger.error(
        "mainWindow not available for sending IPC for Traefik health."
      );
      return;
    }
    if (!containerId) {
      logger.error("No Traefik container ID provided for health check.");
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: "Cannot check Traefik health: Missing container ID.",
      });
      return;
    }

    const command = `docker inspect --format='{{json .State}}' ${containerId}`;
    exec(
      command,
      { env: this.getDockerEnvironment() },
      (error, stdout, stderr) => {
        if (error) {
          logger.error(`Error inspecting Traefik (${containerId}): ${stderr}`);
          if (attempt < maxAttempts) {
            setTimeout(
              () => this.checkTraefikHealth(containerId, attempt + 1),
              retryDelay
            );
          } else {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Traefik (${containerId}) health check timed out: ${stderr}`,
            });
          }
          return;
        }

        try {
          const stateOutput = stdout.trim();
          if (!stateOutput) {
            logger.warn(`Empty state output for ${containerId}. Retrying...`);
            if (attempt < maxAttempts) {
              setTimeout(
                () => this.checkTraefikHealth(containerId, attempt + 1),
                retryDelay
              );
            } else {
              mainWindow.webContents.send("docker-status-update", {
                type: "error",
                message: `Traefik (${containerId}) health check failed: Empty state output after max retries.`,
              });
            }
            return;
          }

          const state = JSON.parse(stateOutput);
          const status = state?.Health?.Status;
          logger.info(
            `Traefik (${containerId}) health status: ${status}, Docker state: ${state.Status}`
          );

          if (
            status === "healthy" ||
            (status === "starting" && state.Status === "running") ||
            (status === undefined && state.Status === "running")
          ) {
            logger.info(
              `Traefik (${containerId}) is operational (Health: ${
                status || "undefined"
              }, State: ${state.Status}).`
            );
            mainWindow.webContents.send("ddalab-services-ready");
          } else if (attempt < maxAttempts) {
            logger.info(
              `Traefik (${containerId}) not healthy (status: ${
                status || state?.Status || "unknown"
              }).`
            );
            setTimeout(
              () => this.checkTraefikHealth(containerId, attempt + 1),
              retryDelay
            );
          } else {
            logger.error(
              `Max attempts reached. Traefik (${containerId}) not healthy (last state: ${JSON.stringify(
                state
              )}).`
            );
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Traefik (${containerId}) did not become healthy status in time (last status: ${
                status || state?.Status || "unknown"
              }).`,
            });
          }
        } catch (error: any) {
          logger.error(
            `Error parsing Traefik state for ${containerId} (raw: '${stdout.trim()}'): ${error}`
          );
          if (attempt < maxAttempts) {
            setTimeout(
              () => this.checkTraefikHealth(containerId, attempt + 1),
              retryDelay
            );
          } else {
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Error parsing Traefik health: ${error.message}. Max retries reached.`,
            });
          }
        }
      }
    );
  }

  static streamDockerLogs(state: ConfigManagerState) {
    const mainWindow = getMainWindow();
    if (!mainWindow || !state.setupPath) {
      logger.error(
        "Cannot stream Docker logs: mainWindow or setupPath not available."
      );
      return;
    }

    if (this.logProcess) {
      this.stopLogStream();
    }

    this.logProcess = spawn("docker-compose", ["logs", "--follow"], {
      cwd: state.setupPath,
      env: this.getDockerEnvironment(),
    });

    this.logProcess.stdout?.on("data", (data) => {
      const logData = data.toString();
      mainWindow.webContents.send("docker-logs", {
        type: "stdout",
        data: logData,
      });
    });

    this.logProcess.stderr?.on("data", (data) => {
      const logData = data.toString();
      mainWindow.webContents.send("docker-logs", {
        type: "stderr",
        data: logData,
      });
    });

    this.logProcess.on("error", (error) => {
      logger.error(`Error in log process: ${error.message}`);
      mainWindow.webContents.send("docker-logs", {
        type: "error",
        data: `Log stream error: ${error.message}`,
      });
    });

    this.logProcess.on("exit", (code) => {
      logger.info(`Log process exited with code: ${code}`);
      this.logProcess = null;
    });
  }

  static stopLogStream() {
    if (this.logProcess) {
      logger.info("Stopping log stream...");
      this.logProcess.kill();
      this.logProcess = null;
    }
  }

  static async fetchCurrentDockerLogs(
    state: ConfigManagerState
  ): Promise<string> {
    if (!state.setupPath) {
      logger.error("Cannot fetch Docker logs: setupPath not available.");
      return "Error fetching logs: Setup path not found.";
    }

    const setupPath: string = state.setupPath; // Explicit type assertion after null check

    const { stdout, stderr } = await new Promise<{
      stdout: string;
      stderr: string;
    }>((resolve) => {
      exec(
        "docker-compose logs --tail=50",
        { cwd: setupPath, env: this.getDockerEnvironment() },
        (error: Error | null, stdout: string, stderr: string) => {
          resolve({ stdout, stderr });
        }
      );
    });

    if (stderr && !stderr.toLowerCase().includes("no containers found")) {
      logger.warn(`Stderr while fetching logs: ${stderr}`);
    }
    return stdout;
  }

  static getIsDockerRunning(): boolean {
    return this.isDockerRunning;
  }

  static async startDockerCompose(state: ConfigManagerState): Promise<boolean> {
    const mainWindow = getMainWindow();
    if (!mainWindow || !state.setupPath) {
      logger.error(
        "Cannot start Docker Compose: mainWindow or setupPath not set."
      );
      return false;
    }

    try {
      const projectName = await this.getDockerProjectName();
      mainWindow.webContents.send("docker-status-update", {
        type: "info",
        message: `Generating volume configuration from DDALAB_ALLOWED_DIRS...`,
      });

      await this.validateDockerFiles(state.setupPath);
      await this.generateDockerVolumes(state.setupPath);

      const composeCommand = `docker-compose -f docker-compose.yml -f docker-compose.volumes.yml up --build -d`;
      logger.info(`Executing compose command: ${composeCommand}`, {
        cwd: state.setupPath,
      });

      return new Promise((resolve) => {
        exec(
          composeCommand,
          { cwd: state.setupPath!, env: this.getDockerEnvironment() },
          async (error, stdout, stderr) => {
            if (error) {
              logger.error(
                `Error starting Docker Compose: ${error.message}. Stderr: ${stderr}`
              );
              let errorMessage = stderr || error.message;
              if (
                errorMessage.includes("mount source path") &&
                errorMessage.includes("prometheus.yml")
              ) {
                errorMessage = `Failed to mount prometheus.yml file. This may be due to Docker Desktop file sharing settings or the file being missing/inaccessible. Original error: ${errorMessage}`;
              } else if (errorMessage.includes("mount source path")) {
                errorMessage = `Docker failed to mount a required file or directory. Check that all required files exist and Docker Desktop has access to the setup directory. Original error: ${errorMessage}`;
              }
              mainWindow.webContents.send("docker-status-update", {
                type: "error",
                message: `Failed to start Docker services: ${errorMessage}`,
              });
              this.isDockerRunning = false;
              this.stopLogStream();
              resolve(false);
            } else {
              logger.info(
                `'docker-compose up -d' successful. Stdout: ${stdout}`
              );
              mainWindow.webContents.send("docker-status-update", {
                type: "success",
                message: "Docker services started. Checking Traefik health...",
              });
              this.isDockerRunning = true;
              this.streamDockerLogs(state);
              const traefikContainerId = await this.getTraefikContainerId(
                projectName
              );
              if (traefikContainerId) {
                this.checkTraefikHealth(traefikContainerId);
              } else {
                logger.error(
                  "Could not get Traefik container ID after startup."
                );
                mainWindow.webContents.send("docker-status-update", {
                  type: "error",
                  message:
                    "Failed to get Traefik ID after startup. Services might not be accessible.",
                });
              }
              resolve(true);
            }
          }
        );
      });
    } catch (error: any) {
      logger.error(`Error generating volumes: ${error.message}`);
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: `Failed to generate volume configuration: ${error.message}`,
      });
      this.isDockerRunning = false;
      this.stopLogStream();
      return false;
    }
  }

  static async stopDockerCompose(
    state: ConfigManagerState,
    deleteVolumes?: boolean
  ): Promise<boolean> {
    const mainWindow = getMainWindow();
    if (!mainWindow || !state.setupPath) {
      logger.error(
        "Cannot stop Docker Compose: mainWindow or setupPath not set."
      );
      return false;
    }

    const projectName = await this.getDockerProjectName();
    let comma = `docker-compose -f docker-compose.yml -f docker-compose.volumes.yml down`;
    if (deleteVolumes) {
      comma += " --volumes";
    }

    mainWindow.webContents.send("docker-status-update", {
      type: "info",
      message: `Stopping Docker services (project: ${projectName}, path: ${state.setupPath})...`,
    });

    return new Promise((resolve) => {
      exec(
        comma,
        { cwd: state.setupPath!, env: this.getDockerEnvironment() },
        (error, stdout, stderr) => {
          if (error) {
            logger.error(
              `Error stopping Docker Compose: ${error.message}. Stderr: ${stderr}`
            );
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Failed to stop Docker services: ${
                stderr || error.message
              }`,
            });
            resolve(false);
          } else {
            logger.info(`'docker compose down' successful. Stdout: ${stdout}`);
            mainWindow.webContents.send("docker-status-update", {
              type: "success",
              message: "Docker services stopped successfully.",
            });
            this.isDockerRunning = false;
            this.stopLogStream();
            resolve(true);
          }
        }
      );
    });
  }
}
