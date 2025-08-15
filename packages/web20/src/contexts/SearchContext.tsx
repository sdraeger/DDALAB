'use client';

import React, { createContext, useContext, useCallback, useRef } from 'react';
import { SearchProvider, SearchableItem, SearchContext as ISearchContext } from '@/types/search';

const SearchContext = createContext<ISearchContext | null>(null);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const providersRef = useRef<Map<string, SearchProvider>>(new Map());

  const registerProvider = useCallback((provider: SearchProvider) => {
    providersRef.current.set(provider.id, provider);
  }, []);

  const unregisterProvider = useCallback((providerId: string) => {
    providersRef.current.delete(providerId);
  }, []);

  const search = useCallback(async (query: string): Promise<SearchableItem[]> => {
    if (!query.trim()) return [];

    const providers = Array.from(providersRef.current.values());
    const results: SearchableItem[] = [];

    // Sort providers by priority (higher priority first)
    const sortedProviders = providers.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Execute searches in parallel
    const searchPromises = sortedProviders.map(async (provider) => {
      try {
        const providerResults = await provider.search(query);
        return providerResults.map(item => ({
          ...item,
          category: item.category || provider.category,
        }));
      } catch (error) {
        console.error(`Search provider ${provider.id} failed:`, error);
        return [];
      }
    });

    const allResults = await Promise.all(searchPromises);
    
    // Flatten and deduplicate results
    const seenIds = new Set<string>();
    for (const providerResults of allResults) {
      for (const item of providerResults) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          results.push(item);
        }
      }
    }

    return results;
  }, []);

  const contextValue: ISearchContext = {
    providers: providersRef.current,
    registerProvider,
    unregisterProvider,
    search,
  };

  return (
    <SearchContext.Provider value={contextValue}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearchContext() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearchContext must be used within a SearchProvider');
  }
  return context;
}