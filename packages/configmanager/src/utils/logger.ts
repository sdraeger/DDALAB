import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

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
  enableFile: boolean;
  maxFileSize: number; // in bytes
  maxFiles: number;
  logDir?: string;
}

class Logger {
  private config: LoggerConfig;
  private logFile?: string;
  private isMainProcess: boolean;
  private context: string;

  constructor(context: string = 'default') {
    this.context = context;
    this.isMainProcess = typeof window === 'undefined';
    
    // Default configuration
    this.config = {
      level: this.getLogLevelFromEnv(),
      enableConsole: process.env.NODE_ENV !== 'production' || process.env.ENABLE_CONSOLE_LOG === 'true',
      enableFile: process.env.NODE_ENV === 'production' && this.isMainProcess,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    };

    if (this.config.enableFile && this.isMainProcess) {
      this.initializeFileLogging();
    }
  }

  private getLogLevelFromEnv(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
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

  private initializeFileLogging(): void {
    try {
      const userDataPath = app.getPath('userData');
      this.config.logDir = path.join(userDataPath, 'logs');
      
      // Create logs directory if it doesn't exist
      if (!fs.existsSync(this.config.logDir)) {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      }

      // Set current log file
      const timestamp = new Date().toISOString().split('T')[0];
      this.logFile = path.join(this.config.logDir, `ddalab-${timestamp}.log`);
      
      // Rotate logs if needed
      this.rotateLogs();
    } catch (error) {
      // Fallback to console only if file logging fails
      this.config.enableFile = false;
      console.error('[Logger] Failed to initialize file logging:', error);
    }
  }

  private rotateLogs(): void {
    if (!this.config.logDir || !this.logFile) return;

    try {
      // Check current log file size
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > this.config.maxFileSize) {
          // Rename current log file with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const rotatedFile = path.join(this.config.logDir, `ddalab-${timestamp}.log`);
          fs.renameSync(this.logFile, rotatedFile);
        }
      }

      // Clean up old log files
      const files = fs.readdirSync(this.config.logDir)
        .filter(f => f.startsWith('ddalab-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.config.logDir!, f),
          time: fs.statSync(path.join(this.config.logDir!, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // Keep only the most recent files
      if (files.length > this.config.maxFiles) {
        files.slice(this.config.maxFiles).forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
    } catch (error) {
      console.error('[Logger] Failed to rotate logs:', error);
    }
  }

  private formatMessage(level: string, message: string, args: any[]): string {
    const timestamp = new Date().toISOString();
    const processType = this.isMainProcess ? 'main' : 'renderer';
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    return `[${timestamp}] [${processType}:${this.context}] [${level}] ${message}${formattedArgs}`;
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

    // File logging (main process only)
    if (this.config.enableFile && this.logFile && this.isMainProcess) {
      try {
        fs.appendFileSync(this.logFile, formattedMessage + '\n');
        
        // Check if rotation is needed after write
        const stats = fs.statSync(this.logFile);
        if (stats.size > this.config.maxFileSize) {
          this.rotateLogs();
        }
      } catch (error) {
        // Silently fail file logging to avoid infinite loops
      }
    }

    // Send to main process if in renderer
    if (!this.isMainProcess && typeof window !== 'undefined' && (window as any).electronAPI?.log) {
      (window as any).electronAPI.log(levelName, this.context, message, args);
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

  enableConsoleLogging(enable: boolean): void {
    this.config.enableConsole = enable;
  }

  enableFileLogging(enable: boolean): void {
    this.config.enableFile = enable;
    if (enable && this.isMainProcess && !this.logFile) {
      this.initializeFileLogging();
    }
  }

  // Create a child logger with a new context
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`);
  }
}

// Create default logger instance
export const logger = new Logger('main');

// Export function to create contextual loggers
export function createLogger(context: string): Logger {
  return new Logger(context);
}

// LogLevel is already exported at the top

// Compatibility layer for existing code
export default {
  debug: (message: string, ...args: any[]) => logger.debug(message, ...args),
  info: (message: string, ...args: any[]) => logger.info(message, ...args),
  warn: (message: string, ...args: any[]) => logger.warn(message, ...args),
  error: (message: string, ...args: any[]) => logger.error(message, ...args),
};