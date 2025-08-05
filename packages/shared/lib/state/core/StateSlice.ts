import {
  StateSlice as IStateSlice,
  StateSliceConfig,
  StateChangeEvent,
  StateListener,
  StateValue,
  StorageAdapter
} from './interfaces';

/**
 * Concrete implementation of StateSlice
 * Manages a single piece of state with validation, transformation, and persistence
 */
export class StateSlice<T extends StateValue = StateValue> implements IStateSlice<T> {
  public readonly key: string;
  public readonly config: StateSliceConfig<T>;

  private currentValue: T;
  private listeners: Set<StateListener<T>> = new Set();
  private history: StateChangeEvent<T>[] = [];
  private storageAdapter?: StorageAdapter;
  private isInitialized = false;

  constructor(config: StateSliceConfig<T>, storageAdapter?: StorageAdapter) {
    this.key = config.key;
    this.config = { ...config };
    this.currentValue = config.defaultValue;
    this.storageAdapter = storageAdapter;

    // Initialize from storage if persistent
    if (config.persistent && storageAdapter) {
      this.initializeFromStorage();
    } else {
      this.isInitialized = true;
    }
  }

  private async initializeFromStorage(): Promise<void> {
    if (!this.storageAdapter || !this.config.persistent) {
      this.isInitialized = true;
      return;
    }

    try {
      const storedValue = await this.storageAdapter.get(this.key);
      
      if (storedValue !== undefined) {
        // Apply transformer if available
        let processedValue = storedValue as T;
        
        if (this.config.transformer) {
          try {
            processedValue = this.config.transformer.deserialize(storedValue);
          } catch (error) {
            console.error(`[StateSlice:${this.key}] Transformation error during init:`, error);
            processedValue = this.config.defaultValue;
          }
        }

        // Validate the value
        if (this.config.validator && !this.config.validator.validate(processedValue)) {
          console.warn(
            `[StateSlice:${this.key}] Stored value failed validation:`,
            this.config.validator.getErrorMessage(processedValue)
          );
          processedValue = this.config.defaultValue;
        }

        this.currentValue = processedValue;
      }
    } catch (error) {
      console.error(`[StateSlice:${this.key}] Error initializing from storage:`, error);
    } finally {
      this.isInitialized = true;
    }
  }

  private async waitForInitialization(): Promise<void> {
    if (this.isInitialized) return;

    return new Promise((resolve) => {
      const checkInit = () => {
        if (this.isInitialized) {
          resolve();
        } else {
          setTimeout(checkInit, 10);
        }
      };
      checkInit();
    });
  }

  getValue(): T {
    return this.currentValue;
  }

  async setValue(value: T): Promise<void> {
    await this.waitForInitialization();

    // Validate the new value
    if (this.config.validator && !this.config.validator.validate(value)) {
      const errorMessage = this.config.validator.getErrorMessage(value);
      throw new Error(`[StateSlice:${this.key}] Validation failed: ${errorMessage}`);
    }

    const oldValue = this.currentValue;
    
    // Early return if value hasn't changed
    if (this.deepEqual(oldValue, value)) {
      return;
    }

    this.currentValue = value;

    // Create change event
    const changeEvent: StateChangeEvent<T> = {
      key: this.key,
      oldValue,
      newValue: value,
      timestamp: Date.now(),
      source: 'direct'
    };

    // Add to history if debugging enabled
    if (this.config.debugEnabled) {
      this.addToHistory(changeEvent);
    }

    // Persist to storage if configured
    if (this.config.persistent && this.storageAdapter) {
      try {
        let valueToStore: StateValue = value;
        
        // Apply transformer if available
        if (this.config.transformer) {
          valueToStore = this.config.transformer.serialize(value);
        }

        await this.storageAdapter.set(this.key, valueToStore);
      } catch (error) {
        console.error(`[StateSlice:${this.key}] Error persisting to storage:`, error);
        
        // Optionally revert the change if persistence fails
        // this.currentValue = oldValue;
        // throw error;
      }
    }

    // Notify listeners
    this.notifyListeners(changeEvent);
  }

  async reset(): Promise<void> {
    await this.setValue(this.config.defaultValue);

    // Clear from storage if persistent
    if (this.config.persistent && this.storageAdapter) {
      try {
        await this.storageAdapter.remove(this.key);
      } catch (error) {
        console.error(`[StateSlice:${this.key}] Error removing from storage:`, error);
      }
    }
  }

  subscribe(listener: StateListener<T>): () => void {
    this.listeners.add(listener);
    
    return () => {
      this.unsubscribe(listener);
    };
  }

  unsubscribe(listener: StateListener<T>): void {
    this.listeners.delete(listener);
  }

  getHistory(): StateChangeEvent<T>[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  private notifyListeners(event: StateChangeEvent<T>): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error(`[StateSlice:${this.key}] Error in listener:`, error);
      }
    });
  }

  private addToHistory(event: StateChangeEvent<T>): void {
    this.history.push(event);
    
    // Limit history size to prevent memory leaks
    const maxHistorySize = 100; // Could be configurable
    if (this.history.length > maxHistorySize) {
      this.history = this.history.slice(-maxHistorySize);
    }
  }

  private deepEqual(a: T, b: T): boolean {
    if (a === b) return true;
    
    if (a === null || b === null || a === undefined || b === undefined) {
      return a === b;
    }

    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
      if (Array.isArray(a) !== Array.isArray(b)) return false;

      if (Array.isArray(a)) {
        const arrayA = a as unknown[];
        const arrayB = b as unknown[];
        
        if (arrayA.length !== arrayB.length) return false;
        
        for (let i = 0; i < arrayA.length; i++) {
          if (!this.deepEqual(arrayA[i] as T, arrayB[i] as T)) return false;
        }
        
        return true;
      } else {
        const objA = a as Record<string, unknown>;
        const objB = b as Record<string, unknown>;
        
        const keysA = Object.keys(objA);
        const keysB = Object.keys(objB);
        
        if (keysA.length !== keysB.length) return false;
        
        for (const key of keysA) {
          if (!keysB.includes(key)) return false;
          if (!this.deepEqual(objA[key] as T, objB[key] as T)) return false;
        }
        
        return true;
      }
    }

    return false;
  }

  /**
   * Get slice metadata for debugging
   */
  getMetadata() {
    return {
      key: this.key,
      config: this.config,
      initialized: this.isInitialized,
      listenerCount: this.listeners.size,
      historySize: this.history.length,
      currentValue: this.currentValue
    };
  }

  /**
   * Dispose of the slice and clean up resources
   */
  dispose(): void {
    this.listeners.clear();
    this.history = [];
  }
}