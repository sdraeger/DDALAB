// Client-side logger that works in both renderer and browser contexts
import { createLogger as createBrowserLogger, logger as browserLogger, LogLevel } from './logger-browser';

// Export the browser-compatible logger for renderer process
export const logger = browserLogger;
export const createLogger = createBrowserLogger;
export { LogLevel };

// Default export for compatibility
export default {
  debug: (message: string, ...args: any[]) => logger.debug(message, ...args),
  info: (message: string, ...args: any[]) => logger.info(message, ...args),
  warn: (message: string, ...args: any[]) => logger.warn(message, ...args),
  error: (message: string, ...args: any[]) => logger.error(message, ...args),
};