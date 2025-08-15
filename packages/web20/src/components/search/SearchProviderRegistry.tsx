'use client';

import { useEffect } from 'react';
import { useSearchContext } from '@/contexts/SearchContext';
import { filesSearchProvider } from '@/lib/search/providers/filesSearchProvider';
import { pagesSearchProvider } from '@/lib/search/providers/pagesSearchProvider';

export function SearchProviderRegistry() {
  const { registerProvider, unregisterProvider } = useSearchContext();

  useEffect(() => {
    // Register built-in providers
    registerProvider(filesSearchProvider);
    registerProvider(pagesSearchProvider);

    return () => {
      // Cleanup on unmount
      unregisterProvider('files');
      unregisterProvider('pages');
    };
  }, [registerProvider, unregisterProvider]);

  return null;
}