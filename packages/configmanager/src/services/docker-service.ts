import { exec, spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger";
import { getMainWindow } from "../utils/main-window";
import { SetupService, ConfigManagerState } from "./setup-service";
import { EnvironmentIsolationService } from "./environment-isolation";
import { EnvGeneratorService } from "./env-generator-service";
import { DockerStatus } from "../../preload"; // Import DockerStatus interface

// Track the Docker Compose process
let dockerComposeProcess: any = null;

export class DockerService {
  private static logProcess: ChildProcess | null = null;
  private static isDockerRunning: boolean = false;
  private static healthCheckInterval: NodeJS.Timeout | null = null;

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

  static async checkDockerInstallation(): Promise<DockerInstallationStatus> {
    const status: DockerInstallationStatus = {
      dockerInstalled: false,
      dockerComposeInstalled: false,
    };

    try {
      // Check Docker installation
      const dockerVersion = await this.execCommand("docker --version");
      if (dockerVersion.success) {
        status.dockerInstalled = true;
        status.dockerVersion = dockerVersion.stdout.trim();
        logger.info(`Docker version: ${status.dockerVersion}`);
      } else {
        logger.warn("Docker not found or not accessible");
        status.error = dockerVersion.stderr || "Docker command not found";
      }

      // Check Docker Compose installation
      const dockerComposeVersion = await this.execCommand(
        "docker compose version"
      );
      if (dockerComposeVersion.success) {
        status.dockerComposeInstalled = true;
        status.dockerComposeVersion = dockerComposeVersion.stdout.trim();
        logger.info(`Docker Compose version: ${status.dockerComposeVersion}`);
      } else {
        logger.warn("Docker Compose not found or not accessible");
        if (!status.error) {
          status.error =
            dockerComposeVersion.stderr || "Docker Compose command not found";
        } else {
          status.error += `; ${
            dockerComposeVersion.stderr || "Docker Compose command not found"
          }`;
        }
      }

      return status;
    } catch (error: any) {
      logger.error(`Error checking Docker installation: ${error.message}`);
      status.error = error.message;
      return status;
    }
  }

  private static async execCommand(
    command: string
  ): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      exec(
        command,
        { env: this.getDockerEnvironment() },
        (error, stdout, stderr) => {
          resolve({
            success: !error,
            stdout: stdout || "",
            stderr: stderr || "",
          });
        }
      );
    });
  }

  static getDockerInstallationInstructions(): string {
    const platform = process.platform;

    switch (platform) {
      case "darwin":
        return `Docker is not installed on your macOS system.

To install Docker:

1. Visit https://www.docker.com/products/docker-desktop
2. Download Docker Desktop for Mac
3. Install the downloaded .dmg file
4. Start Docker Desktop from Applications
5. Wait for Docker to start (you'll see the Docker icon in the menu bar)
6. Restart this application

Alternative installation via Homebrew:
1. Install Homebrew if you haven't already: https://brew.sh
2. Run: brew install --cask docker
3. Start Docker Desktop from Applications`;

      case "win32":
        return `Docker is not installed on your Windows system.

To install Docker:

1. Visit https://www.docker.com/products/docker-desktop
2. Download Docker Desktop for Windows
3. Run the installer and follow the setup wizard
4. Restart your computer if prompted
5. Start Docker Desktop from the Start menu
6. Wait for Docker to start (you'll see the Docker icon in the system tray)
7. Restart this application

Note: Docker Desktop requires Windows 10/11 Pro, Enterprise, or Education. For Windows Home, you may need to use WSL2.`;

      case "linux":
        return `Docker is not installed on your Linux system.

To install Docker:

Ubuntu/Debian:
1. Update package index: sudo apt update
2. Install prerequisites: sudo apt install apt-transport-https ca-certificates curl gnupg lsb-release
3. Add Docker's official GPG key: curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
4. Add Docker repository: echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
5. Install Docker: sudo apt update && sudo apt install docker-ce docker-ce-cli containerd.io docker-compose-plugin
6. Add your user to docker group: sudo usermod -aG docker $USER
7. Log out and log back in, or restart your system

CentOS/RHEL/Fedora:
1. Install Docker: sudo dnf install docker docker-compose-plugin
2. Start Docker service: sudo systemctl start docker
3. Enable Docker service: sudo systemctl enable docker
4. Add your user to docker group: sudo usermod -aG docker $USER
5. Log out and log back in, or restart your system`;

      default:
        return `Docker is not installed on your system.

Please visit https://www.docker.com/products/docker-desktop to download and install Docker Desktop for your operating system.`;
    }
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
    // Use environment-specific env file
    const envFilePath =
      await EnvironmentIsolationService.ensureEnvironmentFileExists(setupPath);
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
      - prometheus_data:/tmp/prometheus
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

    // Use environment isolation for project name
    return EnvironmentIsolationService.getDockerProjectName(state.setupPath);
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

    // Use environment isolation for Docker Compose command
    const composeCommand = EnvironmentIsolationService.getDockerComposeCommand(
      state.setupPath
    );
    const command = `${composeCommand} ps -q traefik`;
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

    // Use environment isolation for Docker Compose command
    const composeCommand = EnvironmentIsolationService.getDockerComposeCommand(
      state.setupPath
    );

    // Parse the project name from the compose command
    const projectMatch = composeCommand.match(/-p\s+([^\s]+)/);
    const projectName = projectMatch ? projectMatch[1] : "default";

    logger.info(`Starting log stream for project: ${projectName}`);
    this.logProcess = spawn(
      "docker",
      ["compose", "-p", projectName, "logs", "--follow"],
      {
        cwd: state.setupPath,
        env: this.getDockerEnvironment(),
      }
    );

    this.logProcess.stdout?.on("data", (data) => {
      const logData = data.toString();
      logger.info(`Docker log (stdout): ${logData.trim()}`);
      console.log("[DockerService] Sending docker-logs event to renderer:", {
        type: "stdout",
        data: logData.trim(),
      });

      const mainWindow = getMainWindow();
      console.log("[DockerService] Main window available:", !!mainWindow);
      if (!mainWindow) {
        console.log(
          "[DockerService] ERROR: Main window is null, cannot send event"
        );
        return;
      }

      mainWindow.webContents.send("docker-logs", {
        type: "stdout",
        data: logData,
      });
    });

    this.logProcess.stderr?.on("data", (data) => {
      const logData = data.toString();
      logger.info(`Docker log (stderr): ${logData.trim()}`);
      console.log("[DockerService] Sending docker-logs event to renderer:", {
        type: "stderr",
        data: logData.trim(),
      });

      const mainWindow = getMainWindow();
      console.log("[DockerService] Main window available:", !!mainWindow);
      if (!mainWindow) {
        console.log(
          "[DockerService] ERROR: Main window is null, cannot send event"
        );
        return;
      }

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
      // Use environment isolation for Docker Compose command
      const composeCommand =
        EnvironmentIsolationService.getDockerComposeCommand(setupPath);
      const command = `${composeCommand} logs --tail=50`;

      exec(
        command,
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

  /**
   * Get the current Docker status (installed, running, etc.)
   */
  static async getDockerStatus(): Promise<DockerStatus> {
    const status: DockerStatus = {
      isRunning: false,
      statusMessage: "Checking Docker status...",
    };

    try {
      const isInstalled = await this.isDockerInstalled();
      if (!isInstalled.dockerInstalled) {
        status.statusMessage = "Docker Desktop is not installed.";
        return status;
      }
      status.version = isInstalled.dockerVersion;

      const isRunning = await this.isDockerDaemonRunning();
      status.isRunning = isRunning;
      status.statusMessage = isRunning
        ? "Docker Desktop is running."
        : "Docker Desktop is not running.";

      return status;
    } catch (error: any) {
      logger.error("Error getting Docker status:", error);
      status.statusMessage = `Failed to get Docker status: ${error.message}`;
      return status;
    }
  }

  /**
   * Check if Docker Desktop is installed and get its version.
   */
  static async isDockerInstalled(): Promise<{
    dockerInstalled: boolean;
    dockerVersion?: string;
  }> {
    return new Promise((resolve) => {
      exec("docker --version", (error, stdout, stderr) => {
        if (error) {
          logger.warn(`Docker not installed: ${stderr}`);
          resolve({ dockerInstalled: false });
        } else {
          const versionMatch = stdout.match(/Docker version (\d+\.\d+\.\d+)/);
          const dockerVersion = versionMatch ? versionMatch[1] : undefined;
          resolve({ dockerInstalled: true, dockerVersion });
        }
      });
    });
  }

  /**
   * Check if Docker daemon is running.
   */
  static async isDockerDaemonRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      exec("docker info", (error, stdout, stderr) => {
        if (error) {
          logger.warn(`Docker daemon not running: ${stderr}`);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Start the monolithic Docker container using docker-compose.
   * Assumes docker-compose.yml and .env are in the setupPath.
   */
  static async startMonolithicDocker(state: any): Promise<boolean> {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      logger.error("Main window not available for starting Docker.");
      return false;
    }

    const setupPath = state.setupPath;
    if (!setupPath) {
      logger.error("Setup path not defined in config manager state.");
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: "Cannot start Docker: Setup path is not defined.",
      });
      return false;
    }

    logger.info(
      `Attempting to start monolithic Docker container at: ${setupPath}`
    );
    mainWindow.webContents.send("docker-status-update", {
      type: "info",
      message: "Starting DDALAB services...",
    });

    try {
      // Ensure .env file exists and is up to date
      await SetupService.generateEnvFile(
        setupPath,
        state.userSelections?.envVariables || {}
      );
      // Generate docker-compose.volumes.yml (ensure bind mounts are correctly set)
      await SetupService.generateVolumeConfig(
        setupPath,
        state.userSelections?.envVariables || {}
      );
      // Update docker-compose.yml to ensure it uses the monolithic image
      await SetupService.updateDockerCompose(
        setupPath,
        state.userSelections?.envVariables || {}
      );

      return new Promise((resolve, reject) => {
        // Use 'up -d' to start services in detached mode
        dockerComposeProcess = exec(
          `docker compose --file ${path.join(setupPath, "docker-compose.yml")} up -d`,
          { cwd: setupPath },
          (error, stdout, stderr) => {
            if (error) {
              logger.error(`Error starting Docker Compose: ${error.message}`);
              mainWindow.webContents.send("docker-status-update", {
                type: "error",
                message: `Failed to start Docker: ${stderr || error.message}`,
              });
              return reject(false);
            }
            logger.info(`Docker Compose started. Stdout: ${stdout}`);
            mainWindow.webContents.send("docker-status-update", {
              type: "success",
              message: "DDALAB services started successfully.",
            });
            resolve(true);
          }
        );
      });
    } catch (error: any) {
      logger.error(`Pre-start setup failed: ${error.message}`);
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: `Failed to prepare Docker setup: ${error.message}`,
      });
      return false;
    }
  }

  /**
   * Stop the monolithic Docker container using docker-compose.
   */
  static async stopMonolithicDocker(
    state: any,
    deleteVolumes: boolean
  ): Promise<boolean> {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      logger.error("Main window not available for stopping Docker.");
      return false;
    }

    const setupPath = state.setupPath;
    if (!setupPath) {
      logger.error("Setup path not defined in config manager state.");
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: "Cannot stop Docker: Setup path is not defined.",
      });
      return false;
    }

    logger.info(
      `Attempting to stop monolithic Docker container at: ${setupPath}`
    );
    mainWindow.webContents.send("docker-status-update", {
      type: "info",
      message: "Stopping DDALAB services...",
    });

    try {
      return new Promise((resolve, reject) => {
        const command = deleteVolumes
          ? `docker compose --file ${path.join(setupPath, "docker-compose.yml")} down -v` // -v to remove volumes
          : `docker compose --file ${path.join(setupPath, "docker-compose.yml")} down`;

        exec(command, { cwd: setupPath }, (error, stdout, stderr) => {
          if (error) {
            logger.error(`Error stopping Docker Compose: ${error.message}`);
            mainWindow.webContents.send("docker-status-update", {
              type: "error",
              message: `Failed to stop Docker: ${stderr || error.message}`,
            });
            return reject(false);
          }
          logger.info(`Docker Compose stopped. Stdout: ${stdout}`);
          mainWindow.webContents.send("docker-status-update", {
            type: "success",
            message: deleteVolumes
              ? "DDALAB services stopped and volumes deleted."
              : "DDALAB services stopped successfully.",
          });
          resolve(true);
        });
      });
    } catch (error: any) {
      logger.error(`Stop command failed: ${error.message}`);
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: `Failed to execute stop command: ${error.message}`,
      });
      return false;
    }
  }

  /**
   * Stream Docker logs.
   */
  static startDockerLogStream(state: any): boolean {
    const mainWindow = getMainWindow();
    if (!mainWindow) return false;

    const setupPath = state.setupPath;
    if (!setupPath) {
      logger.error("Setup path not defined for log stream.");
      return false;
    }

    logger.info("Starting Docker log stream...");
    // Kill any existing process
    if (dockerComposeProcess) {
      dockerComposeProcess.kill("SIGTERM");
      dockerComposeProcess = null;
    }

    try {
      dockerComposeProcess = spawn(
        "docker",
        [
          "compose",
          "--file",
          path.join(setupPath, "docker-compose.yml"),
          "logs",
          "-f",
        ],
        { cwd: setupPath }
      );

      dockerComposeProcess.stdout.on("data", (data: Buffer) => {
        const log = data.toString();
        mainWindow.webContents.send("docker-logs", {
          type: "stdout",
          data: log,
        });
      });

      dockerComposeProcess.stderr.on("data", (data: Buffer) => {
        const log = data.toString();
        mainWindow.webContents.send("docker-logs", {
          type: "stderr",
          data: log,
        });
      });

      dockerComposeProcess.on("close", (code: number) => {
        logger.info(`Docker Compose logs process exited with code ${code}`);
        mainWindow.webContents.send("docker-logs", {
          type: "info",
          data: `Log stream ended with code ${code}`,
        });
        dockerComposeProcess = null;
      });

      dockerComposeProcess.on("error", (err: Error) => {
        logger.error(`Docker Compose logs process error: ${err.message}`);
        mainWindow.webContents.send("docker-logs", {
          type: "error",
          data: `Log stream error: ${err.message}`,
        });
        dockerComposeProcess = null;
      });

      mainWindow.webContents.send("docker-log-update", {
        type: "info",
        message: "Log stream started.",
      });
      return true;
    } catch (error) {
      logger.error("Failed to start Docker log stream:", error);
      mainWindow.webContents.send("docker-log-update", {
        type: "error",
        message: `Failed to start log stream: ${error}`,
      });
      return false;
    }
  }

  /**
   * Remove the Docker log stream.
   */
  static removeDockerLogStream(): void {
    if (dockerComposeProcess) {
      dockerComposeProcess.kill("SIGTERM");
      dockerComposeProcess = null;
      logger.info("Docker log stream removed.");
    }
  }

  static async checkAllServicesHealth(): Promise<boolean> {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      logger.error("Cannot check services health: mainWindow not set.");
      return false;
    }

    try {
      const state = await SetupService.getConfigManagerState();
      if (!state.setupPath) {
        logger.error("Cannot check services health: setupPath not available.");
        return false;
      }

      const projectName = await this.getDockerProjectName();
      // Use environment isolation for Docker Compose command
      const composeCommand =
        EnvironmentIsolationService.getDockerComposeCommand(state.setupPath);
      const command = `${composeCommand} ps --format json`;

      return new Promise((resolve) => {
        exec(
          command,
          { cwd: state.setupPath!, env: this.getDockerEnvironment() },
          async (error, stdout, stderr) => {
            if (error) {
              logger.error(
                `Error checking services health: ${error.message}. Stderr: ${stderr}`
              );
              mainWindow.webContents.send("docker-status-update", {
                type: "error",
                message: `Failed to check services health: ${
                  stderr || error.message
                }`,
              });
              resolve(false);
              return;
            }

            try {
              // docker-compose ps --format json returns multiple JSON objects (one per line)
              // We need to parse each line as a separate JSON object
              const lines = stdout
                .trim()
                .split("\n")
                .filter((line) => line.trim());
              const services = lines
                .map((line) => {
                  try {
                    return JSON.parse(line);
                  } catch (e) {
                    logger.warn(`Failed to parse JSON line: ${line}`);
                    return null;
                  }
                })
                .filter((service) => service !== null);

              const requiredServices = [
                "web",
                "api",
                "minio",
                "postgres",
                "traefik",
              ];
              let allHealthy = true;
              const unhealthyServices: string[] = [];

              for (const service of services) {
                if (requiredServices.includes(service.Service)) {
                  const isHealthy =
                    service.State === "running" &&
                    (!service.Health ||
                      service.Health === "healthy" ||
                      service.Health === "starting");

                  if (!isHealthy) {
                    allHealthy = false;
                    unhealthyServices.push(service.Service);
                  }
                }
              }

              if (!allHealthy) {
                logger.warn(
                  `Unhealthy services detected: ${unhealthyServices.join(", ")}`
                );
                mainWindow.webContents.send("docker-status-update", {
                  type: "warning",
                  message: `Services unhealthy: ${unhealthyServices.join(
                    ", "
                  )}`,
                });
              } else {
                logger.info("All services are healthy");
                mainWindow.webContents.send("docker-status-update", {
                  type: "success",
                  message: "All services are healthy",
                });
              }

              resolve(allHealthy);
            } catch (parseError) {
              logger.error(`Error parsing services status: ${parseError}`);
              mainWindow.webContents.send("docker-status-update", {
                type: "error",
                message: `Error checking services health: ${parseError}`,
              });
              resolve(false);
            }
          }
        );
      });
    } catch (error: any) {
      logger.error(`Error in checkAllServicesHealth: ${error.message}`);
      mainWindow.webContents.send("docker-status-update", {
        type: "error",
        message: `Error checking services health: ${error.message}`,
      });
      return false;
    }
  }

  static startPeriodicHealthCheck(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      if (this.isDockerRunning) {
        const isHealthy = await this.checkAllServicesHealth();
        const mainWindow = getMainWindow();
        if (mainWindow) {
          if (isHealthy) {
            mainWindow.webContents.send("ddalab-services-ready");
          } else {
            mainWindow.webContents.send("docker-status-update", {
              type: "warning",
              message: "Some services are unhealthy",
            });
            mainWindow.webContents.send("docker-services-unhealthy");
          }
        }
      }
    }, intervalMs);
  }

  static stopPeriodicHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Clear all Docker resources for testing isolation
   */
  static async clearTestingResources(): Promise<void> {
    try {
      logger.info("Clearing Docker testing resources...");

      // Stop and remove all containers with the test prefix
      const { exec } = await import("child_process");
      const util = await import("util");
      const execAsync = util.promisify(exec);

      // Get all containers with test prefix
      const { stdout: containers } = await execAsync(
        "docker ps -a --filter name=ddalab-test --format '{{.Names}}'"
      );

      if (containers.trim()) {
        const containerNames = containers.trim().split("\n");
        for (const containerName of containerNames) {
          if (containerName) {
            try {
              await execAsync(`docker rm -f ${containerName}`);
              logger.info(`Removed container: ${containerName}`);
            } catch (error) {
              logger.warn(
                `Failed to remove container ${containerName}:`,
                error
              );
            }
          }
        }
      }

      // Remove test volumes
      const { stdout: volumes } = await execAsync(
        "docker volume ls --filter name=ddalab_test --format '{{.Name}}'"
      );

      if (volumes.trim()) {
        const volumeNames = volumes.trim().split("\n");
        for (const volumeName of volumeNames) {
          if (volumeName) {
            try {
              await execAsync(`docker volume rm ${volumeName}`);
              logger.info(`Removed volume: ${volumeName}`);
            } catch (error) {
              logger.warn(`Failed to remove volume ${volumeName}:`, error);
            }
          }
        }
      }

      // Remove test networks
      const { stdout: networks } = await execAsync(
        "docker network ls --filter name=ddalab_test --format '{{.Name}}'"
      );

      if (networks.trim()) {
        const networkNames = networks.trim().split("\n");
        for (const networkName of networkNames) {
          if (networkName) {
            try {
              await execAsync(`docker network rm ${networkName}`);
              logger.info(`Removed network: ${networkName}`);
            } catch (error) {
              logger.warn(`Failed to remove network ${networkName}:`, error);
            }
          }
        }
      }

      logger.info("Docker testing resources cleared successfully");
    } catch (error: any) {
      logger.error("Failed to clear Docker testing resources:", error);
    }
  }

  // Method to get installation instructions (placeholder for now)
  static getInstallationInstructions(): string {
    return "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/";
  }

  // Method to get config manager state (to avoid circular dependency with SetupService)
  static async getConfigManagerState(): Promise<ConfigManagerState> {
    return SetupService.getConfigManagerState();
  }
}
