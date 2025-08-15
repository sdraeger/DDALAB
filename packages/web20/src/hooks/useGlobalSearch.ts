'use client';

import { useState, useCallback, useRef } from 'react';
import { SearchableItem } from '@/types/search';
import { useSearchContext } from '@/contexts/SearchContext';

export function useGlobalSearch() {
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const { search } = useSearchContext();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const searchResults = await search(searchQuery);
      setResults(searchResults);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [search]);

  const debouncedSearch = useCallback((searchQuery: string) => {
    setQuery(searchQuery);
    
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);
  }, [performSearch]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setIsSearching(false);
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
  }, []);

  const selectResult = useCallback((item: SearchableItem) => {
    if (item.onSelect) {
      item.onSelect();
    }
    clearSearch();
  }, [clearSearch]);

  return {
    query,
    results,
    isSearching,
    search: debouncedSearch,
    performSearch,
    clearSearch,
    selectResult,
  };
}