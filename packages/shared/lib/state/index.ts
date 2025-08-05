/**
 * Centralized State Management System
 * 
 * A robust, modular, and maintainable state management solution
 * following SOLID principles with automatic persistence,
 * debugging tools, and cross-tab synchronization.
 */

// Core interfaces and types
export type {
  StateValue,
  StateChangeEvent,
  StateValidator,
  StateTransformer,
  StateListener,
  StorageAdapter,
  StateSliceConfig,
  StateSlice,
  StateStore,
  StateContextConfig,
  StateHookReturn,
  ComputedState,
  StateMiddleware,
  StatePlugin
} from './core/interfaces';

// Core implementations
export { StateSlice } from './core/StateSlice';
export { StateStore } from './core/StateStore';

// Storage adapters
export { LocalStorageAdapter } from './adapters/localStorage';
export { IndexedDBAdapter } from './adapters/indexedDB';

// React integration
export { StateProvider, useStateStore, useStateReady } from './react/StateContext';
export {
  useState,
  useStateValue,
  useComputedState,
  useStateListener,
  useStateDebug,
  useStateBackup,
  useBatchState
} from './react/hooks';

// Debugging tools
export { StateDebugger, useStateDebugger } from './debug/StateDebugger';

// Middleware
export {
  LoggingMiddleware,
  PerformanceMiddleware,
  ValidationMiddleware
} from './middleware/LoggingMiddleware';

// Plugins
export {
  PersistencePlugin,
  CrossTabSyncPlugin,
  HistoryPlugin
} from './plugins/PersistencePlugin';

// Utilities and helpers
export * from './utils/validators';
export * from './utils/transformers';