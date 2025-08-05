import type { StateMiddleware, StateChangeEvent } from '../core/interfaces';

/**
 * Logging middleware for debugging state changes
 */
export class LoggingMiddleware implements StateMiddleware {
  private enabledKeys: Set<string> | null;
  private logLevel: 'debug' | 'info' | 'warn';

  constructor(
    options: {
      keys?: string[];
      logLevel?: 'debug' | 'info' | 'warn';
    } = {}
  ) {
    this.enabledKeys = options.keys ? new Set(options.keys) : null;
    this.logLevel = options.logLevel ?? 'debug';
  }

  async beforeChange<T>(event: Omit<StateChangeEvent<T>, 'timestamp'>): Promise<boolean> {
    if (this.shouldLog(event.key)) {
      console[this.logLevel](
        `[State] ${event.key}: ${JSON.stringify(event.oldValue)} → ${JSON.stringify(event.newValue)}`
      );
    }
    return true; // Always allow the change
  }

  async afterChange<T>(event: StateChangeEvent<T>): Promise<void> {
    // Could add post-change logging here if needed
  }

  private shouldLog(key: string): boolean {
    return this.enabledKeys === null || this.enabledKeys.has(key);
  }

  /**
   * Enable logging for specific keys
   */
  enableKeys(keys: string[]): void {
    if (this.enabledKeys === null) {
      this.enabledKeys = new Set();
    }
    keys.forEach(key => this.enabledKeys!.add(key));
  }

  /**
   * Disable logging for specific keys
   */
  disableKeys(keys: string[]): void {
    if (this.enabledKeys !== null) {
      keys.forEach(key => this.enabledKeys!.delete(key));
    }
  }

  /**
   * Enable logging for all keys
   */
  enableAll(): void {
    this.enabledKeys = null;
  }

  /**
   * Disable all logging
   */
  disableAll(): void {
    this.enabledKeys = new Set();
  }
}

/**
 * Performance monitoring middleware
 */
export class PerformanceMiddleware implements StateMiddleware {
  private slowThreshold: number;
  private measurements: Map<string, number> = new Map();

  constructor(slowThreshold: number = 100) {
    this.slowThreshold = slowThreshold;
  }

  async beforeChange<T>(event: Omit<StateChangeEvent<T>, 'timestamp'>): Promise<boolean> {
    this.measurements.set(event.key, performance.now());
    return true;
  }

  async afterChange<T>(event: StateChangeEvent<T>): Promise<void> {
    const startTime = this.measurements.get(event.key);
    if (startTime !== undefined) {
      const duration = performance.now() - startTime;
      
      if (duration > this.slowThreshold) {
        console.warn(`[State Performance] Slow update for "${event.key}": ${duration.toFixed(2)}ms`);
      }

      this.measurements.delete(event.key);
    }
  }

  /**
   * Get performance statistics
   */
  getStats(): { averageTime: number; slowUpdates: number } {
    // This would require more sophisticated tracking in a real implementation
    return { averageTime: 0, slowUpdates: 0 };
  }
}

/**
 * Validation middleware that prevents invalid state changes
 */
export class ValidationMiddleware implements StateMiddleware {
  private validators: Map<string, (value: any) => boolean> = new Map();
  private errorMessages: Map<string, string> = new Map();

  /**
   * Add a validator for a specific state key
   */
  addValidator(
    key: string, 
    validator: (value: any) => boolean, 
    errorMessage: string = 'Validation failed'
  ): void {
    this.validators.set(key, validator);
    this.errorMessages.set(key, errorMessage);
  }

  /**
   * Remove validator for a key
   */
  removeValidator(key: string): void {
    this.validators.delete(key);
    this.errorMessages.delete(key);
  }

  async beforeChange<T>(event: Omit<StateChangeEvent<T>, 'timestamp'>): Promise<boolean> {
    const validator = this.validators.get(event.key);
    
    if (validator && !validator(event.newValue)) {
      const errorMessage = this.errorMessages.get(event.key) || 'Validation failed';
      console.error(`[State Validation] ${event.key}: ${errorMessage}`);
      return false; // Block the change
    }

    return true;
  }

  async afterChange<T>(event: StateChangeEvent<T>): Promise<void> {
    // No post-change validation needed
  }
}