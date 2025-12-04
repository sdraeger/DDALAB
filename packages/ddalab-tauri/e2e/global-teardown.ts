import { generateReport } from "./utils/coverage";
import * as fs from "fs";

const PID_FILE = "/tmp/ddalab-api-server.pid";
const CONNECTION_INFO_FILE = "/tmp/ddalab-api-server.json";

async function globalTeardown() {
  if (process.env.COVERAGE === "true") {
    console.log("Generating coverage report...");
    await generateReport();
  }

  // Stop the API server if it was started
  if (fs.existsSync(PID_FILE)) {
    console.log("\n=== Stopping DDALAB API Server ===");

    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);

      if (pid && !isNaN(pid)) {
        console.log(`🛑 Stopping API server (PID: ${pid})...`);

        try {
          // Kill the process and its children (negative PID kills process group)
          process.kill(-pid, "SIGTERM");
        } catch (killError: any) {
          // Try killing just the main process if group kill fails
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // Process might already be dead
          }
        }

        // Wait a moment for clean shutdown
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Force kill if still running
        try {
          process.kill(pid, 0); // Check if process exists
          console.log("⚠️  Process still running, sending SIGKILL...");
          process.kill(pid, "SIGKILL");
        } catch {
          // Process is dead, which is what we want
        }

        console.log("✅ API server stopped");
      }
    } catch (error) {
      console.error(`Failed to stop API server: ${error}`);
    }

    // Clean up PID file
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // File might not exist
    }
  }

  // Clean up connection info file
  if (fs.existsSync(CONNECTION_INFO_FILE)) {
    try {
      fs.unlinkSync(CONNECTION_INFO_FILE);
    } catch {
      // File might not exist
    }
  }

  console.log("==================================\n");
}

export default globalTeardown;
