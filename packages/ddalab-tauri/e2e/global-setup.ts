import { spawn, ChildProcess } from "child_process";
import { initCoverageDir } from "./utils/coverage";
import {
  ensureDeterministicFixtures,
  DATA_DIRECTORY,
} from "./utils/test-fixtures";
import * as fs from "fs";
import * as path from "path";

let apiServerProcess: ChildProcess | null = null;

// Connection info file path
const CONNECTION_INFO_FILE = "/tmp/ddalab-api-server.json";

const API_SERVER_BINARY_CANDIDATES = [
  path.resolve(__dirname, "../src-tauri/target/release/api-server"),
  path.resolve(__dirname, "../src-tauri/target/debug/api-server"),
];

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

async function waitForConnectionInfo(
  maxAttempts = 30,
): Promise<Record<string, string> | null> {
  for (let i = 0; i < maxAttempts; i++) {
    if (fs.existsSync(CONNECTION_INFO_FILE)) {
      return JSON.parse(fs.readFileSync(CONNECTION_INFO_FILE, "utf-8"));
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

function resolveApiServerBinary(): string | null {
  return (
    API_SERVER_BINARY_CANDIDATES.find((candidate) =>
      fs.existsSync(candidate),
    ) ?? null
  );
}

async function globalSetup() {
  if (process.env.COVERAGE === "true") {
    console.log("Initializing coverage collection...");
    initCoverageDir();
  }

  ensureDeterministicFixtures();

  // Desktop E2E runs against Tauri IPC by default; only start legacy API server
  // when explicitly requested.
  const startApiServer = process.env.START_API_SERVER === "true";

  if (startApiServer) {
    console.log("\n=== Starting DDALAB API Server for E2E Tests ===");

    const apiServerBinary = resolveApiServerBinary();

    // Check if binary exists
    if (!apiServerBinary) {
      console.log(
        `\n⚠️  API server binary not found at: ${API_SERVER_BINARY_CANDIDATES.join(", ")}`,
      );
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
    console.log(`🔧 Binary: ${apiServerBinary}`);

    // Clean up any existing connection info file
    if (fs.existsSync(CONNECTION_INFO_FILE)) {
      fs.unlinkSync(CONNECTION_INFO_FILE);
    }

    // Start the API server
    const port = process.env.API_PORT || "8765";
    apiServerProcess = spawn(
      apiServerBinary,
      [
        "--http",
        "--data-dir",
        DATA_DIRECTORY,
        "--port",
        port,
        "--connection-info-file",
        CONNECTION_INFO_FILE,
      ],
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

      const info = await waitForConnectionInfo();
      if (info) {
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
