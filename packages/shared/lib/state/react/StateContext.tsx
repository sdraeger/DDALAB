"use client";

import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { StateStore } from '../core/StateStore';
import { LocalStorageAdapter } from '../adapters/localStorage';
import { IndexedDBAdapter } from '../adapters/indexedDB';
import type { StorageAdapter } from '../core/interfaces';

/**
 * React context for the centralized state management system
 */

interface StateContextValue {
  store: StateStore;
}

const StateContext = createContext<StateContextValue | null>(null);

interface StateProviderProps {
  children: ReactNode;
  storageType?: 'localStorage' | 'indexedDB' | 'memory';
  storagePrefix?: string;
  enableDebug?: boolean;
  syncInterval?: number;
}

/**
 * Memory adapter for testing or when persistence is not needed
 */
class MemoryAdapter implements StorageAdapter {
  private storage = new Map<string, any>();

  async get(key: string) {
    return this.storage.get(key);
  }

  async set(key: string, value: any) {
    this.storage.set(key, value);
  }

  async remove(key: string) {
    this.storage.delete(key);
  }

  async clear() {
    this.storage.clear();
  }

  async getAllKeys() {
    return Array.from(this.storage.keys());
  }

  async has(key: string) {
    return this.storage.has(key);
  }
}

/**
 * Provider component that sets up the state management system
 */
export function StateProvider({
  children,
  storageType = 'localStorage',
  storagePrefix = 'ddalab_state_',
  enableDebug = process.env.NODE_ENV === 'development',
  syncInterval = 30000 // 30 seconds
}: StateProviderProps) {
  const storeRef = useRef<StateStore | null>(null);

  // Initialize store only once
  if (!storeRef.current) {
    let adapter: StorageAdapter;

    switch (storageType) {
      case 'indexedDB':
        adapter = new IndexedDBAdapter(
          `${storagePrefix}db`,
          1,
          'state_store'
        );
        break;
      case 'memory':
        adapter = new MemoryAdapter();
        break;
      case 'localStorage':
      default:
        adapter = new LocalStorageAdapter(storagePrefix);
        break;
    }

    storeRef.current = new StateStore(adapter, {
      debugEnabled: enableDebug,
      syncInterval
    });

    if (enableDebug) {
      console.log('[StateProvider] Initialized with storage type:', storageType);
    }
  }

  // Hydrate store on mount
  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;

    let isMounted = true;

    const initializeStore = async () => {
      try {
        await store.hydrate();

        if (isMounted && enableDebug) {
          console.log('[StateProvider] Store hydrated successfully');
        }
      } catch (error) {
        if (isMounted) {
          console.error('[StateProvider] Store hydration failed:', error);
        }
      }
    };

    initializeStore();

    return () => {
      isMounted = false;
    };
  }, [enableDebug]);

  const contextValue: StateContextValue = {
    store: storeRef.current
  };

  return (
    <StateContext.Provider value={contextValue}>
      {children}
    </StateContext.Provider>
  );
}

/**
 * Hook to access the state store
 */
export function useStateStore(): StateStore {
  const context = useContext(StateContext);

  if (!context) {
    throw new Error('useStateStore must be used within a StateProvider');
  }

  return context.store;
}

/**
 * Hook to check if the state system is ready
 */
export function useStateReady(): boolean {
  const store = useStateStore();
  const [isReady, setIsReady] = React.useState<boolean>(false);

  useEffect(() => {
    const checkReady = () => {
      const debugInfo = store.getDebugInfo();
      setIsReady(debugInfo.isHydrated);
    };

    checkReady();

    // Check periodically in case hydration happens async
    const interval = setInterval(checkReady, 100);

    // Clean up after a reasonable time
    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [store]);

  return isReady;
}