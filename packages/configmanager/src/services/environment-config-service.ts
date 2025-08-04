import { app } from "electron";
import { logger } from "../utils/logger";

export type Environment = "dev" | "beta" | "production";

export class EnvironmentConfigService {
  private static currentEnvironment: Environment = "dev";

  static initialize(): Environment {
    // Determine environment based on app name and version
    const appName = app.getName();
    const version = app.getVersion();

    if (appName.includes("Dev") || version.includes("dev")) {
      this.currentEnvironment = "dev";
    } else if (appName.includes("Beta") || version.includes("beta")) {
      this.currentEnvironment = "beta";
    } else {
      this.currentEnvironment = "production";
    }

    logger.info(
      `Environment detected: ${this.currentEnvironment} (app: ${appName}, version: ${version})`
    );
    return this.currentEnvironment;
  }

  static getCurrentEnvironment(): Environment {
    return this.currentEnvironment;
  }

  static isDevelopment(): boolean {
    return this.currentEnvironment === "dev";
  }

  static isBeta(): boolean {
    return this.currentEnvironment === "beta";
  }

  static isProduction(): boolean {
    return this.currentEnvironment === "production";
  }
}
