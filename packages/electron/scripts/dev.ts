import { spawn } from "child_process";
import * as path from "path";
import electron from "electron";

// Start the Electron app
function startElectron() {
  const electronPath = require("electron") as typeof electron;
  const electronProcess = spawn(
    electronPath as unknown as string,
    [path.join(__dirname, "../dist/main/main.js")],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
    }
  );

  electronProcess.on("close", () => {
    process.exit();
  });
}

// Start the development process
async function main() {
  console.log("Starting Electron app in development mode...");
  startElectron();
}

main().catch(console.error);
