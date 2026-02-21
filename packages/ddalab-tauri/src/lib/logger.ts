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
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|auth|cookie|session|email)/i;
const PATH_KEY_PATTERN = /(path|file|directory)/i;
const MAX_SANITIZE_DEPTH = 4;
const MAX_ARRAY_PREVIEW = 25;

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

function getBaseName(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || "(root)";
}

function sanitizeValue(
  value: unknown,
  keyHint?: string,
  depth: number = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (depth > MAX_SANITIZE_DEPTH) {
    return "[MaxDepth]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
      return "[REDACTED]";
    }
    if (keyHint && PATH_KEY_PATTERN.test(keyHint) && value.length > 0) {
      return getBaseName(value);
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const preview = value
      .slice(0, MAX_ARRAY_PREVIEW)
      .map((entry) => sanitizeValue(entry, keyHint, depth + 1, seen));
    if (value.length > MAX_ARRAY_PREVIEW) {
      preview.push(`[...${value.length - MAX_ARRAY_PREVIEW} more]`);
    }
    return preview;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) {
      return "[Circular]";
    }
    seen.add(value as object);
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = sanitizeValue(nestedValue, key, depth + 1, seen);
    }
    return result;
  }

  return String(value);
}

function sanitizeContext(context?: LogContext): LogContext | undefined {
  if (!context) {
    return undefined;
  }
  return sanitizeValue(context) as LogContext;
}

function createLogEntry(
  level: LogLevel,
  namespace: string,
  message: string,
  context?: LogContext,
): LogEntry {
  const sanitizedContext = sanitizeContext(context);
  return {
    timestamp: new Date().toISOString(),
    level,
    namespace,
    message,
    context: sanitizedContext,
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
    const sanitizedContext = entry.context;

    switch (level) {
      case "debug":
        // eslint-disable-next-line no-console
        if (sanitizedContext) {
          console.info(formattedMessage, sanitizedContext);
        } else {
          console.info(formattedMessage);
        }
        break;
      case "info":
        if (sanitizedContext) {
          console.info(formattedMessage, sanitizedContext);
        } else {
          console.info(formattedMessage);
        }
        break;
      case "warn":
        if (sanitizedContext) {
          console.warn(formattedMessage, sanitizedContext);
        } else {
          console.warn(formattedMessage);
        }
        break;
      case "error":
        if (sanitizedContext) {
          console.error(formattedMessage, sanitizedContext);
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
