// Shim logger for browser environment
// This file is used when Node.js modules are not available

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  NONE = 5
}

class ShimLogger {
  debug(message: string, ...args: any[]): void {
    console.debug(`[SHIM] ${message}`, ...args);
  }

  info(message: string, ...args: any[]): void {
    console.log(`[SHIM] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[SHIM] ${message}`, ...args);
  }

  error(message: string, error?: Error | any, ...args: any[]): void {
    console.error(`[SHIM] ${message}`, error, ...args);
  }

  fatal(message: string, error?: Error | any, ...args: any[]): void {
    console.error(`[SHIM] FATAL: ${message}`, error, ...args);
  }

  setLevel(level: LogLevel): void {
    // No-op in shim
  }

  getLevel(): LogLevel {
    return LogLevel.DEBUG;
  }

  enableConsoleLogging(enable: boolean): void {
    // No-op in shim
  }

  enableFileLogging(enable: boolean): void {
    // No-op in shim
  }

  child(context: string): ShimLogger {
    return new ShimLogger();
  }
}

export const logger = new ShimLogger();

export function createLogger(context: string): ShimLogger {
  return new ShimLogger();
}

export default {
  debug: (message: string, ...args: any[]) => logger.debug(message, ...args),
  info: (message: string, ...args: any[]) => logger.info(message, ...args),
  warn: (message: string, ...args: any[]) => logger.warn(message, ...args),
  error: (message: string, ...args: any[]) => logger.error(message, ...args),
};