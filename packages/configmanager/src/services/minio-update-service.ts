import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger";

const execAsync = promisify(exec);

export interface MinIOUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  lastChecked: string;
}

export class MinIOUpdateService {
  private static updateInfo: MinIOUpdateInfo | null = null;

  /**
   * Check if MinIO update is available
   */
  static async checkForMinIOUpdate(): Promise<MinIOUpdateInfo> {
    try {
      logger.info("Checking for MinIO updates...");

      // Get current MinIO version from docker-compose
      const currentVersion = await this.getCurrentMinIOVersion();

      // Get latest MinIO version from Docker Hub
      const latestVersion = await this.getLatestMinIOVersion();

      const updateAvailable = currentVersion !== latestVersion;

      this.updateInfo = {
        currentVersion,
        latestVersion,
        updateAvailable,
        lastChecked: new Date().toISOString(),
      };

      logger.info("MinIO update check completed:", this.updateInfo);
      return this.updateInfo;
    } catch (error: any) {
      logger.error("Error checking for MinIO updates:", error);
      throw error;
    }
  }

  /**
   * Get current MinIO version from docker-compose files
   */
  private static async getCurrentMinIOVersion(): Promise<string> {
    try {
      // This would read the docker-compose files to get current version
      // For now, return a placeholder
      return "RELEASE.2025-03-12T18-04-18Z";
    } catch (error) {
      logger.error("Error getting current MinIO version:", error);
      return "unknown";
    }
  }

  /**
   * Get latest MinIO version from Docker Hub
   */
  private static async getLatestMinIOVersion(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        "curl -s https://registry.hub.docker.com/v2/repositories/minio/minio/tags/ | jq -r '.results[] | select(.name | contains(\"RELEASE\")) | .name' | head -1"
      );
      return stdout.trim();
    } catch (error) {
      logger.error("Error getting latest MinIO version:", error);
      return "unknown";
    }
  }

  /**
   * Update MinIO to latest version
   */
  static async updateMinIO(): Promise<{ success: boolean; message: string }> {
    try {
      logger.info("Starting MinIO update...");

      // Get latest version
      const latestVersion = await this.getLatestMinIOVersion();

      if (latestVersion === "unknown") {
        return {
          success: false,
          message: "Failed to get latest MinIO version",
        };
      }

      // Update docker-compose files
      await this.updateDockerComposeFiles(latestVersion);

      // Pull new image
      await this.pullMinIOImage(latestVersion);

      // Restart MinIO service
      await this.restartMinIOService();

      logger.info("MinIO update completed successfully");
      return {
        success: true,
        message: `MinIO updated to ${latestVersion}`,
      };
    } catch (error: any) {
      logger.error("Error updating MinIO:", error);
      return {
        success: false,
        message: `Update failed: ${error.message}`,
      };
    }
  }

  /**
   * Update docker-compose files with new MinIO version
   */
  private static async updateDockerComposeFiles(
    version: string
  ): Promise<void> {
    try {
      // Update docker-compose.yml
      await execAsync(
        `sed -i.bak "s|minio/minio:RELEASE\\.[0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}T[0-9]\\{2\\}-[0-9]\\{2\\}-[0-9]\\{2\\}Z|minio/minio:${version}|g" docker-compose.yml`
      );

      // Update docker-compose.dev.yml
      await execAsync(
        `sed -i.bak "s|minio/minio:RELEASE\\.[0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}T[0-9]\\{2\\}-[0-9]\\{2\\}-[0-9]\\{2\\}Z|minio/minio:${version}|g" docker-compose.dev.yml`
      );

      logger.info("Docker Compose files updated");
    } catch (error) {
      logger.error("Error updating Docker Compose files:", error);
      throw error;
    }
  }

  /**
   * Pull new MinIO image
   */
  private static async pullMinIOImage(version: string): Promise<void> {
    try {
      await execAsync(`docker pull minio/minio:${version}`);
      logger.info("MinIO image pulled successfully");
    } catch (error) {
      logger.error("Error pulling MinIO image:", error);
      throw error;
    }
  }

  /**
   * Restart MinIO service
   */
  private static async restartMinIOService(): Promise<void> {
    try {
      await execAsync("docker-compose stop minio");
      await execAsync("docker-compose up -d minio");
      logger.info("MinIO service restarted");
    } catch (error) {
      logger.error("Error restarting MinIO service:", error);
      throw error;
    }
  }

  /**
   * Get current update info
   */
  static getUpdateInfo(): MinIOUpdateInfo | null {
    return this.updateInfo;
  }
}
