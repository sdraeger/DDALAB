import { logger } from './logger-client';

interface ErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  componentName?: string;
  level: 'page' | 'section' | 'component';
  timestamp: string;
  context?: Record<string, any>;
}

interface ErrorReportingOptions {
  sendToMain?: boolean;
  showNotification?: boolean;
  autoRecover?: boolean;
  recoveryDelay?: number;
}

class ErrorReporter {
  private errorQueue: ErrorReport[] = [];
  private isReporting = false;
  private maxQueueSize = 50;

  constructor() {
    this.setupGlobalErrorHandlers();
  }

  private setupGlobalErrorHandlers() {
    window.addEventListener('unhandledrejection', (event) => {
      this.report({
        message: `Unhandled Promise Rejection: ${event.reason}`,
        stack: event.reason?.stack,
        level: 'page',
        timestamp: new Date().toISOString(),
        context: {
          type: 'unhandledrejection',
          promise: event.promise,
        },
      });
    });

    window.addEventListener('error', (event) => {
      this.report({
        message: event.message,
        stack: event.error?.stack,
        level: 'page',
        timestamp: new Date().toISOString(),
        context: {
          type: 'error',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    });
  }

  report(
    error: Error | ErrorReport,
    options: ErrorReportingOptions = {}
  ): void {
    const {
      sendToMain = true,
      showNotification = false,
      autoRecover = false,
      recoveryDelay = 5000,
    } = options;

    const errorReport: ErrorReport = this.isErrorReport(error)
      ? error
      : this.createErrorReport(error);

    logger.error('Error Report:', errorReport);

    this.addToQueue(errorReport);

    if (sendToMain && window.electronAPI) {
      this.sendToMainProcess(errorReport);
    }

    if (showNotification && window.electronAPI) {
      this.showNotification(errorReport);
    }

    if (autoRecover) {
      setTimeout(() => {
        this.attemptRecovery(errorReport);
      }, recoveryDelay);
    }
  }

  private isErrorReport(error: any): error is ErrorReport {
    return (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      'level' in error &&
      'timestamp' in error
    );
  }

  private createErrorReport(error: Error): ErrorReport {
    return {
      message: error.message,
      stack: error.stack,
      level: 'component',
      timestamp: new Date().toISOString(),
      context: {
        name: error.name,
      },
    };
  }

  private addToQueue(report: ErrorReport): void {
    this.errorQueue.push(report);
    
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
  }

  private async sendToMainProcess(report: ErrorReport): Promise<void> {
    if (this.isReporting || !window.electronAPI) return;

    this.isReporting = true;

    try {
      await window.electronAPI.reportError({
        message: report.message,
        stack: report.stack,
        componentName: report.componentName,
        level: report.level,
        timestamp: report.timestamp,
        context: JSON.stringify(report.context),
      });
    } catch (error) {
      logger.error('Failed to send error report to main process:', error);
    } finally {
      this.isReporting = false;
    }
  }

  private async showNotification(report: ErrorReport): Promise<void> {
    if (!window.electronAPI) return;

    try {
      const title = `${report.level.charAt(0).toUpperCase()}${report.level.slice(1)} Error`;
      const body = report.componentName
        ? `Error in ${report.componentName}: ${report.message}`
        : report.message;

      await window.electronAPI.showNotification({
        title,
        body,
        type: 'error',
      });
    } catch (error) {
      logger.error('Failed to show error notification:', error);
    }
  }

  private attemptRecovery(report: ErrorReport): void {
    logger.info(`Attempting recovery for error: ${report.message}`);
    
    switch (report.level) {
      case 'component':
        break;
      case 'section':
        if (report.componentName && window.electronAPI) {
          window.electronAPI.navigateToSection('welcome');
        }
        break;
      case 'page':
        window.location.reload();
        break;
    }
  }

  getErrorHistory(limit?: number): ErrorReport[] {
    const history = [...this.errorQueue];
    return limit ? history.slice(-limit) : history;
  }

  clearErrorHistory(): void {
    this.errorQueue = [];
  }

  getErrorStats(): {
    total: number;
    byLevel: Record<string, number>;
    recent: number;
  } {
    const stats = {
      total: this.errorQueue.length,
      byLevel: {} as Record<string, number>,
      recent: 0,
    };

    const recentThreshold = Date.now() - 5 * 60 * 1000;

    this.errorQueue.forEach((error) => {
      stats.byLevel[error.level] = (stats.byLevel[error.level] || 0) + 1;
      
      if (new Date(error.timestamp).getTime() > recentThreshold) {
        stats.recent++;
      }
    });

    return stats;
  }
}

export const errorReporter = new ErrorReporter();

export const reportError = (
  error: Error | ErrorReport,
  options?: ErrorReportingOptions
) => errorReporter.report(error, options);

export const getErrorHistory = (limit?: number) =>
  errorReporter.getErrorHistory(limit);

export const getErrorStats = () => errorReporter.getErrorStats();