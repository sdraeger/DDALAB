import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { app, BrowserWindow } from "electron";

const execAsync = promisify(exec);

let isDockerRunning = false;
let logProcess: ChildProcess | null = null;

// Function to stream logs from docker compose
function streamDockerLogs(mainWindow: BrowserWindow | null) {
  if (!mainWindow) return;

  if (logProcess) {
    stopLogStream(); // Stop existing stream before starting a new one
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
    console.error("[docker-service] Error in log process:", error);
    if (mainWindow) {
      mainWindow.webContents.send("docker-logs", {
        type: "error",
        data: `Log stream error: ${error.message}`,
      });
    }
  });

  logProcess.on("exit", (code) => {
    console.log(`[docker-service] Log process exited with code: ${code}`);
    // Optionally send a message to renderer about log stream ending
  });
}

// Function to stop the log stream
export function stopLogStream() {
  if (logProcess) {
    console.log("[docker-service] Stopping log stream...");
    logProcess.kill();
    logProcess = null;
  }
}

// Main function to run docker compose up or down
export async function manageDockerCompose(
  command: "up" | "down",
  mainWindow: BrowserWindow | null,
  deleteVolumes?: boolean
): Promise<boolean> {
  try {
    let dockerCmd = `docker compose ${command}`;
    if (command === "up") {
      dockerCmd += " -d";
    } else if (command === "down" && deleteVolumes) {
      dockerCmd += " --volumes";
    }
    dockerCmd = dockerCmd.trim();

    console.log(`[docker-service] Executing Docker command: ${dockerCmd}`);

    const { stdout, stderr } = await execAsync(dockerCmd, {
      cwd: app.getAppPath(), // Or your docker-compose.yml directory
    });

    console.log(`[docker-service] Docker Compose ${command} stdout:`, stdout);
    if (stderr) {
      console.error(
        `[docker-service] Docker Compose ${command} stderr:`,
        stderr
      );
      // Avoid treating all stderr as a failure, as compose down often writes to stderr on success
      if (command === "up" && stderr.toLowerCase().includes("error")) {
        isDockerRunning = false; // ensure status is correct if 'up' failed critically
        // throw new Error(stderr); // or handle more gracefully
      }
    }

    isDockerRunning = command === "up";

    if (command === "up") {
      if (mainWindow) streamDockerLogs(mainWindow);
    } else {
      stopLogStream();
    }
    return true;
  } catch (error: any) {
    console.error(
      `[docker-service] Error running docker-compose ${command}:`,
      error.message
    );
    console.error(`[docker-service] Error stdout:`, error.stdout);
    console.error(`[docker-service] Error stderr:`, error.stderr);
    isDockerRunning = false; // Ensure status is updated on error
    if (command === "up") {
      // If 'up' failed, no need to try and stop a non-existent stream.
      stopLogStream(); // Clean up if somehow a log process started.
    }
    return false;
  }
}

// Function to get the current status of Docker
export function getIsDockerRunning(): boolean {
  return isDockerRunning;
}

// Function to fetch recent Docker logs
export async function fetchCurrentDockerLogs(): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(
      "docker compose logs --tail=50",
      {
        cwd: app.getAppPath(),
      }
    );
    if (stderr && !stderr.toLowerCase().includes("no containers found")) {
      // common benign stderr
      console.warn("[docker-service] Stderr while fetching logs:", stderr);
    }
    return stdout;
  } catch (error: any) {
    console.error("[docker-service] Error getting docker logs:", error.message);
    return `Error fetching logs: ${error.message}`;
  }
}
