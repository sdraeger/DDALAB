import { spawn, ChildProcess } from "child_process";
import { initCoverageDir } from "./utils/coverage";
import * as fs from "fs";
import * as path from "path";

let apiServerProcess: ChildProcess | null = null;

// Connection info file path
const CONNECTION_INFO_FILE = "/tmp/ddalab-api-server.json";

// API server binary path (relative to this e2e folder)
// e2e folder is at packages/ddalab-tauri/e2e, binary is at packages/ddalab-tauri/src-tauri/target/release/api-server
const API_SERVER_BINARY = path.resolve(
  __dirname,
  "../src-tauri/target/release/api-server",
);

// Data directory path (relative to monorepo root)
// e2e folder is at packages/ddalab-tauri/e2e, data is at data/
const DATA_DIRECTORY = path.resolve(__dirname, "../../../data");

async function waitForServer(url: string, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function globalSetup() {
  if (process.env.COVERAGE === "true") {
    console.log("Initializing coverage collection...");
    initCoverageDir();
  }

  // Check if we should start the API server
  const startApiServer = process.env.START_API_SERVER !== "false";

  if (startApiServer) {
    console.log("\n=== Starting DDALAB API Server for E2E Tests ===");

    // Check if binary exists
    if (!fs.existsSync(API_SERVER_BINARY)) {
      console.log(`\n⚠️  API server binary not found at: ${API_SERVER_BINARY}`);
      console.log("Building the API server binary...");
      console.log(
        "Run: cd src-tauri && cargo build --bin api-server --release",
      );
      console.log(
        "\nSkipping API server start - tests will run in browser-only mode.",
      );
      return;
    }

    // Check if data directory exists
    if (!fs.existsSync(DATA_DIRECTORY)) {
      console.log(`\n⚠️  Data directory not found at: ${DATA_DIRECTORY}`);
      console.log(
        "Skipping API server start - tests will run in browser-only mode.",
      );
      return;
    }

    console.log(`📁 Data directory: ${DATA_DIRECTORY}`);
    console.log(`🔧 Binary: ${API_SERVER_BINARY}`);

    // Clean up any existing connection info file
    if (fs.existsSync(CONNECTION_INFO_FILE)) {
      fs.unlinkSync(CONNECTION_INFO_FILE);
    }

    // Start the API server
    const port = process.env.API_PORT || "8765";
    apiServerProcess = spawn(
      API_SERVER_BINARY,
      ["--data-dir", DATA_DIRECTORY, "--port", port],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );

    // Store PID for cleanup
    if (apiServerProcess.pid) {
      fs.writeFileSync(
        "/tmp/ddalab-api-server.pid",
        apiServerProcess.pid.toString(),
      );
    }

    // Log output
    apiServerProcess.stdout?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[API] ${msg}`);
    });

    apiServerProcess.stderr?.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[API ERROR] ${msg}`);
    });

    apiServerProcess.on("error", (err) => {
      console.error(`[API] Failed to start API server: ${err.message}`);
    });

    // Wait for server to be ready
    const serverUrl = `http://127.0.0.1:${port}`;
    console.log(`⏳ Waiting for API server at ${serverUrl}...`);

    const isReady = await waitForServer(serverUrl);

    if (isReady) {
      console.log(`✅ API server is ready at ${serverUrl}`);

      // Read connection info if written by the server
      if (fs.existsSync(CONNECTION_INFO_FILE)) {
        const info = JSON.parse(fs.readFileSync(CONNECTION_INFO_FILE, "utf-8"));
        console.log(`📡 API URL: ${info.url}`);
        process.env.API_URL = info.url;
        process.env.API_SESSION_TOKEN = info.session_token;
      } else {
        process.env.API_URL = serverUrl;
      }
    } else {
      console.error("❌ API server failed to start within timeout");
      console.log("Tests will run in browser-only mode.");
    }

    console.log("================================================\n");
  }
}

export default globalSetup;
