import { spawn, ChildProcess } from "child_process";
import logger from "shared/lib/utils/logger";

export class NextDevManager {
  private nextDevServer: ChildProcess | null = null;
  private readonly port: number;

  constructor(port: number = 3001) {
    this.port = port;
  }

  start(): void {
    logger.info(`Starting Next.js dev server on internal port ${this.port}...`);

    this.nextDevServer = spawn(
      "npx",
      ["next", "dev", "--port", this.port.toString()],
      {
        stdio: ["ignore", "inherit", "inherit"], // pipe stdout/stderr from next dev to this process
        shell: true, // Use shell for npx compatibility across platforms
      }
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.nextDevServer) return;

    this.nextDevServer.on("error", (error) => {
      logger.error("Failed to start Next.js dev server:", error);
    });

    this.nextDevServer.on("exit", (code, signal) => {
      if (code !== null) {
        logger.info(`Next.js dev server exited with code ${code}`);
      } else if (signal !== null) {
        logger.info(`Next.js dev server killed with signal ${signal}`);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.nextDevServer || this.nextDevServer.killed) {
        resolve();
        return;
      }

      logger.info("Stopping Next.js dev server...");

      const killed = this.nextDevServer.kill("SIGTERM"); // Send SIGTERM for graceful shutdown

      if (!killed) {
        logger.warn(
          "Failed to kill Next.js dev server gracefully, forcing SIGKILL."
        );
        this.nextDevServer.kill("SIGKILL");
      }

      // Give it some time to shut down gracefully
      setTimeout(() => {
        resolve();
      }, 2000);
    });
  }

  isRunning(): boolean {
    return this.nextDevServer !== null && !this.nextDevServer.killed;
  }

  getPort(): number {
    return this.port;
  }

  getTarget(): string {
    return `http://localhost:${this.port}`;
  }
}
