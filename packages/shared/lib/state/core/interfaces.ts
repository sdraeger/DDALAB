/**
 * Core interfaces for the centralized state management system
 * Following SOLID principles for maintainable and extensible state management
 */

// Single Responsibility: Each interface has one clear purpose

/**
 * Represents a serializable state value
 */
export type StateValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | StateValue[]
  | { [key: string]: StateValue };

/**
 * State change event data
 */
export interface StateChangeEvent<T = StateValue> {
  key: string;
  oldValue: T | undefined;
  newValue: T | undefined;
  timestamp: number;
  source: string;
}

/**
 * State validator interface - validates state before changes
 */
export interface StateValidator<T = StateValue> {
  validate(value: T): boolean;
  getErrorMessage(value: T): string;
}

/**
 * State transformer interface - transforms state during get/set
 */
export interface StateTransformer<TInput = StateValue, TOutput = StateValue> {
  serialize(value: TInput): TOutput;
  deserialize(value: TOutput): TInput;
}

/**
 * State listener interface
 */
export interface StateListener<T = StateValue> {
  (event: StateChangeEvent<T>): void;
}

/**
 * Storage adapter interface - abstracts storage implementation
 */
export interface StorageAdapter {
  get(key: string): Promise<StateValue | undefined>;
  set(key: string, value: StateValue): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<string[]>;
  has(key: string): Promise<boolean>;
}

/**
 * State slice configuration
 */
export interface StateSliceConfig<T = StateValue> {
  key: string;
  defaultValue: T;
  validator?: StateValidator<T>;
  transformer?: StateTransformer<T>;
  persistent?: boolean;
  syncAcrossInstances?: boolean;
  debugEnabled?: boolean;
}

/**
 * State slice interface - manages a specific piece of state
 */
export interface StateSlice<T = StateValue> {
  readonly key: string;
  readonly config: StateSliceConfig<T>;

  getValue(): T;
  setValue(value: T): Promise<void>;
  reset(): Promise<void>;

  subscribe(listener: StateListener<T>): () => void;
  unsubscribe(listener: StateListener<T>): void;

  // For debugging
  getHistory(): StateChangeEvent<T>[];
  clearHistory(): void;
}

/**
 * State store interface - central state management
 */
export interface StateStore {
  // Slice management
  registerSlice<T extends StateValue = StateValue>(
    config: StateSliceConfig<T>
  ): StateSlice<T>;
  unregisterSlice(key: string): void;
  getSlice<T extends StateValue = StateValue>(
    key: string
  ): StateSlice<T> | undefined;
  getAllSlices(): StateSlice[];

  // Global operations
  hydrate(): Promise<void>;
  dehydrate(): Promise<void>;
  reset(): Promise<void>;

  // Event system
  onStateChange(listener: StateListener): () => void;

  // Debugging
  getDebugInfo(): {
    slices: string[];
    totalEvents: number;
    lastUpdate: number;
  };
}

/**
 * State context configuration
 */
export interface StateContextConfig {
  storageAdapter: StorageAdapter;
  enableDebug?: boolean;
  enableHistory?: boolean;
  maxHistorySize?: number;
  syncInterval?: number;
}

/**
 * State hook return type
 */
export interface StateHookReturn<T = StateValue> {
  value: T;
  setValue: (value: T) => Promise<void>;
  reset: () => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Computed state interface - derived state
 */
export interface ComputedState<T = StateValue> {
  readonly key: string;
  readonly dependencies: string[];
  compute(...values: StateValue[]): T;
  subscribe(listener: StateListener<T>): () => void;
}

/**
 * State middleware interface - intercepts state changes
 */
export interface StateMiddleware {
  beforeChange<T>(
    event: Omit<StateChangeEvent<T>, "timestamp">
  ): Promise<boolean>;
  afterChange<T>(event: StateChangeEvent<T>): Promise<void>;
}

/**
 * State plugin interface - extends store functionality
 */
export interface StatePlugin {
  readonly name: string;
  install(store: StateStore): void;
  uninstall?(store: StateStore): void;
}
