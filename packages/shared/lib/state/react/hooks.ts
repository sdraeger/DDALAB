"use client";

import { useState as useReactState, useEffect, useCallback, useRef } from 'react';
import { useStateStore } from './StateContext';
import type {
  StateSliceConfig,
  StateValue,
  StateHookReturn,
  StateSlice,
  StateChangeEvent
} from '../core/interfaces';

/**
 * Main hook for managing state with automatic registration and cleanup
 */
export function useState<T extends StateValue = StateValue>(
  config: StateSliceConfig<T>
): StateHookReturn<T> {
  const store = useStateStore();
  const [value, setValue] = useReactState<T>(config.defaultValue);
  const [isLoading, setIsLoading] = useReactState(true);
  const [error, setError] = useReactState<Error | null>(null);
  const sliceRef = useRef<StateSlice<T> | null>(null);
  const isInitializedRef = useRef(false);

  // Register slice and set up subscription
  useEffect(() => {
    let slice: StateSlice<T>;
    
    try {
      // Check if slice already exists
      const existingSlice = store.getSlice<T>(config.key);
      
      if (existingSlice) {
        slice = existingSlice;
      } else {
        slice = store.registerSlice(config);
      }
      
      sliceRef.current = slice;

      // Set initial value
      setValue(slice.getValue());
      
      // Subscribe to changes
      const unsubscribe = slice.subscribe((event: StateChangeEvent<T>) => {
        setValue(event.newValue);
      });

      setIsLoading(false);
      isInitializedRef.current = true;

      return () => {
        unsubscribe();
        // Don't unregister slice here as other components might be using it
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to initialize state');
      setError(error);
      setIsLoading(false);
      console.error(`[useState:${config.key}] Initialization error:`, error);
    }
  }, [store, config.key]); // Only depend on store and key to avoid re-registration

  // Create stable setter function
  const setValueCallback = useCallback(async (newValue: T) => {
    if (!sliceRef.current) {
      throw new Error(`State slice "${config.key}" is not initialized`);
    }

    try {
      setError(null);
      await sliceRef.current.setValue(newValue);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to set state value');
      setError(error);
      throw error;
    }
  }, [config.key]);

  // Create stable reset function
  const resetCallback = useCallback(async () => {
    if (!sliceRef.current) {
      throw new Error(`State slice "${config.key}" is not initialized`);
    }

    try {
      setError(null);
      await sliceRef.current.reset();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to reset state');
      setError(error);
      throw error;
    }
  }, [config.key]);

  return {
    value,
    setValue: setValueCallback,
    reset: resetCallback,
    isLoading,
    error
  };
}

/**
 * Hook for read-only access to state
 */
export function useStateValue<T extends StateValue = StateValue>(
  key: string,
  defaultValue?: T
): T | undefined {
  const store = useStateStore();
  const [value, setValue] = useReactState<T | undefined>(defaultValue);

  useEffect(() => {
    const slice = store.getSlice<T>(key);
    
    if (!slice) {
      setValue(defaultValue);
      return;
    }

    // Set initial value
    setValue(slice.getValue());

    // Subscribe to changes
    const unsubscribe = slice.subscribe((event: StateChangeEvent<T>) => {
      setValue(event.newValue);
    });

    return unsubscribe;
  }, [store, key, defaultValue]);

  return value;
}

/**
 * Hook for computed/derived state
 */
export function useComputedState<T extends StateValue = StateValue>(
  dependencies: string[],
  computeFn: (...values: StateValue[]) => T,
  debugKey?: string
): T | undefined {
  const store = useStateStore();
  const [computedValue, setComputedValue] = useReactState<T | undefined>(undefined);
  const computeFnRef = useRef(computeFn);

  // Update compute function ref
  useEffect(() => {
    computeFnRef.current = computeFn;
  }, [computeFn]);

  useEffect(() => {
    const slices = dependencies.map(key => store.getSlice(key)).filter(Boolean);
    
    if (slices.length !== dependencies.length) {
      // Not all dependencies are available yet
      setComputedValue(undefined);
      return;
    }

    // Compute initial value
    const values = slices.map(slice => slice.getValue());
    const initialValue = computeFnRef.current(...values);
    setComputedValue(initialValue);

    // Subscribe to all dependencies
    const unsubscribes = slices.map(slice => 
      slice.subscribe(() => {
        const currentValues = slices.map(s => s.getValue());
        const newValue = computeFnRef.current(...currentValues);
        setComputedValue(newValue);
      })
    );

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [store, dependencies.join(',')]); // Join dependencies for stable comparison

  return computedValue;
}

/**
 * Hook for listening to multiple state changes
 */
export function useStateListener(
  keys: string[],
  listener: (events: StateChangeEvent[]) => void,
  options?: { immediate?: boolean }
): void {
  const store = useStateStore();
  const listenerRef = useRef(listener);

  // Update listener ref
  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    const slices = keys.map(key => store.getSlice(key)).filter(Boolean);
    
    if (slices.length === 0) return;

    // Fire immediately if requested
    if (options?.immediate) {
      const initialEvents: StateChangeEvent[] = slices.map(slice => ({
        key: slice.key,
        oldValue: undefined,
        newValue: slice.getValue(),
        timestamp: Date.now(),
        source: 'initial'
      }));
      
      listenerRef.current(initialEvents);
    }

    // Subscribe to all slices
    const unsubscribes = slices.map(slice =>
      slice.subscribe((event) => {
        listenerRef.current([event]);
      })
    );

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [store, keys.join(','), options?.immediate]);
}

/**
 * Hook for debugging state
 */
export function useStateDebug(key?: string) {
  const store = useStateStore();
  const [debugInfo, setDebugInfo] = useReactState<any>(null);

  useEffect(() => {
    const updateDebugInfo = () => {
      if (key) {
        const slice = store.getSlice(key);
        if (slice && 'getMetadata' in slice && typeof slice.getMetadata === 'function') {
          setDebugInfo(slice.getMetadata());
        }
      } else {
        setDebugInfo(store.getDebugInfo());
      }
    };

    updateDebugInfo();

    // Update periodically
    const interval = setInterval(updateDebugInfo, 1000);

    return () => clearInterval(interval);
  }, [store, key]);

  return debugInfo;
}

/**
 * Hook to export/import state for backup/testing
 */
export function useStateBackup() {
  const store = useStateStore();

  const exportState = useCallback(() => {
    return store.exportState();
  }, [store]);

  const importState = useCallback(async (state: Record<string, StateValue>) => {
    await store.importState(state);
  }, [store]);

  const resetAllState = useCallback(async () => {
    await store.reset();
  }, [store]);

  return {
    exportState,
    importState,
    resetAllState
  };
}

/**
 * Hook for batch state operations
 */
export function useBatchState() {
  const store = useStateStore();

  const batchUpdate = useCallback(async (
    updates: Array<{ key: string; value: StateValue }>
  ) => {
    const promises = updates.map(async ({ key, value }) => {
      const slice = store.getSlice(key);
      if (slice) {
        await slice.setValue(value);
      }
    });

    await Promise.all(promises);
  }, [store]);

  const batchReset = useCallback(async (keys: string[]) => {
    const promises = keys.map(async (key) => {
      const slice = store.getSlice(key);
      if (slice) {
        await slice.reset();
      }
    });

    await Promise.all(promises);
  }, [store]);

  return {
    batchUpdate,
    batchReset
  };
}