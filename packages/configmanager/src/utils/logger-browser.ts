// Browser-compatible logger for renderer process
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  NONE = 5
}

interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
}

class BrowserLogger {
  private config: LoggerConfig;
  private context: string;

  constructor(context: string = 'renderer') {
    this.context = context;
    
    // Default configuration for browser
    this.config = {
      level: this.getLogLevelFromEnv(),
      enableConsole: true // Always enable in browser, controlled by level
    };
  }

  private getLogLevelFromEnv(): LogLevel {
    // In browser, we might get this from window object or localStorage
    const envLevel = (window as any).__LOG_LEVEL__?.toUpperCase() || 
                     localStorage.getItem('LOG_LEVEL')?.toUpperCase();
    
    switch (envLevel) {
      case 'DEBUG': return LogLevel.DEBUG;
      case 'INFO': return LogLevel.INFO;
      case 'WARN': return LogLevel.WARN;
      case 'ERROR': return LogLevel.ERROR;
      case 'FATAL': return LogLevel.FATAL;
      case 'NONE': return LogLevel.NONE;
      default: return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
    }
  }

  private formatMessage(level: string, message: string, args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    return `[${timestamp}] [renderer:${this.context}] [${level}] ${message}${formattedArgs}`;
  }

  private log(level: LogLevel, levelName: string, message: string, ...args: any[]): void {
    if (level < this.config.level) return;

    const formattedMessage = this.formatMessage(levelName, message, args);

    // Console logging
    if (this.config.enableConsole) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formattedMessage);
          break;
        case LogLevel.INFO:
          console.log(formattedMessage);
          break;
        case LogLevel.WARN:
          console.warn(formattedMessage);
          break;
        case LogLevel.ERROR:
        case LogLevel.FATAL:
          console.error(formattedMessage);
          break;
      }
    }

    // Send to main process if IPC is available
    if (typeof window !== 'undefined' && (window as any).electronAPI?.log) {
      try {
        (window as any).electronAPI.log(levelName, this.context, message, args);
      } catch (error) {
        // Silently fail IPC logging
      }
    }
  }

  debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, 'INFO', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, 'WARN', message, ...args);
  }

  error(message: string, error?: Error | any, ...args: any[]): void {
    if (error instanceof Error) {
      this.log(LogLevel.ERROR, 'ERROR', `${message}: ${error.message}`, { stack: error.stack, ...args });
    } else if (error) {
      this.log(LogLevel.ERROR, 'ERROR', message, error, ...args);
    } else {
      this.log(LogLevel.ERROR, 'ERROR', message, ...args);
    }
  }

  fatal(message: string, error?: Error | any, ...args: any[]): void {
    if (error instanceof Error) {
      this.log(LogLevel.FATAL, 'FATAL', `${message}: ${error.message}`, { stack: error.stack, ...args });
    } else if (error) {
      this.log(LogLevel.FATAL, 'FATAL', message, error, ...args);
    } else {
      this.log(LogLevel.FATAL, 'FATAL', message, ...args);
    }
  }

  // Utility methods
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  getLevel(): LogLevel {
    return this.config.level;
  }

  // Create a child logger with a new context
  child(context: string): BrowserLogger {
    return new BrowserLogger(`${this.context}:${context}`);
  }
}

// Create default logger instance
export const logger = new BrowserLogger('renderer');

// Export function to create contextual loggers
export function createLogger(context: string): BrowserLogger {
  return new BrowserLogger(context);
}

// Compatibility layer for existing code
export default {
  debug: (message: string, ...args: any[]) => logger.debug(message, ...args),
  info: (message: string, ...args: any[]) => logger.info(message, ...args),
  warn: (message: string, ...args: any[]) => logger.warn(message, ...args),
  error: (message: string, ...args: any[]) => logger.error(message, ...args),
};