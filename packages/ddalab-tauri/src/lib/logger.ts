/**
 * Structured logger utility for consistent logging across the application
 * Provides namespaced logging with structured context for easier debugging
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  namespace: string;
  message: string;
  context?: LogContext;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// In production, only log warnings and errors to avoid console noise
// In development, log everything for debugging
const MIN_LOG_LEVEL: LogLevel =
  process.env.NODE_ENV === "production" ? "warn" : "debug";

// In-memory log storage for copy/export functionality
const MAX_LOG_ENTRIES = 500;
const logHistory: LogEntry[] = [];

function addToHistory(entry: LogEntry): void {
  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_ENTRIES) {
    logHistory.shift();
  }
}

export function getLogHistory(): LogEntry[] {
  return [...logHistory];
}

export function clearLogHistory(): void {
  logHistory.length = 0;
}

export function formatLogEntry(entry: LogEntry): string {
  const contextStr =
    entry.context && Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context)}`
      : "";
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.namespace}] ${entry.message}${contextStr}`;
}

export function formatLogHistoryAsText(): string {
  return logHistory.map(formatLogEntry).join("\n");
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

function formatMessage(entry: LogEntry): string {
  const prefix = `[${entry.namespace}]`;
  if (entry.context && Object.keys(entry.context).length > 0) {
    return `${prefix} ${entry.message}`;
  }
  return `${prefix} ${entry.message}`;
}

function createLogEntry(
  level: LogLevel,
  namespace: string,
  message: string,
  context?: LogContext,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    namespace,
    message,
    context,
  };
}

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  child: (childNamespace: string) => Logger;
}

/**
 * Creates a namespaced logger instance
 * @param namespace - The namespace for this logger (e.g., "DDA", "FileManager", "API")
 * @returns A logger instance with debug, info, warn, error methods
 *
 * @example
 * const logger = createLogger("DDA");
 * logger.info("Analysis started", { analysisId: "abc123", channels: 3 });
 * logger.error("Analysis failed", { error: "timeout" });
 *
 * // Create a child logger for more specific context
 * const analysisLogger = logger.child("Analysis");
 * analysisLogger.debug("Processing chunk", { chunkIndex: 5 });
 */
export function createLogger(namespace: string): Logger {
  const log = (
    level: LogLevel,
    message: string,
    context?: LogContext,
  ): void => {
    const entry = createLogEntry(level, namespace, message, context);

    // Always add to history for copy/export functionality
    addToHistory(entry);

    // Only output to console if log level meets threshold
    if (!shouldLog(level)) return;

    const formattedMessage = formatMessage(entry);

    switch (level) {
      case "debug":
        // eslint-disable-next-line no-console
        if (context) {
          console.info(formattedMessage, context);
        } else {
          console.info(formattedMessage);
        }
        break;
      case "info":
        if (context) {
          console.info(formattedMessage, context);
        } else {
          console.info(formattedMessage);
        }
        break;
      case "warn":
        if (context) {
          console.warn(formattedMessage, context);
        } else {
          console.warn(formattedMessage);
        }
        break;
      case "error":
        if (context) {
          console.error(formattedMessage, context);
        } else {
          console.error(formattedMessage);
        }
        break;
    }
  };

  return {
    debug: (message: string, context?: LogContext) =>
      log("debug", message, context),
    info: (message: string, context?: LogContext) =>
      log("info", message, context),
    warn: (message: string, context?: LogContext) =>
      log("warn", message, context),
    error: (message: string, context?: LogContext) =>
      log("error", message, context),
    child: (childNamespace: string) =>
      createLogger(`${namespace}:${childNamespace}`),
  };
}

// Pre-configured loggers for common namespaces
export const loggers = {
  dda: createLogger("DDA"),
  fileManager: createLogger("FileManager"),
  api: createLogger("API"),
  tauri: createLogger("Tauri"),
  store: createLogger("Store"),
  plot: createLogger("Plot"),
  annotations: createLogger("Annotations"),
  nsg: createLogger("NSG"),
  notifications: createLogger("Notifications"),
  streaming: createLogger("Streaming"),
  export: createLogger("Export"),
  ui: createLogger("UI"),
  wasm: createLogger("WASM"),
  persistence: createLogger("Persistence"),
} as const;

// Default export for general use
export default createLogger;
