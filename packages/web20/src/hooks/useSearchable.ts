'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { SearchableItem, SearchProvider, UseSearchableOptions } from '@/types/search';
import { useSearchContext } from '@/contexts/SearchContext';

// Default search function that performs fuzzy text matching
const defaultSearchFn = (query: string, items: SearchableItem[]): SearchableItem[] => {
  const lowercaseQuery = query.toLowerCase();
  
  return items.filter(item => {
    const searchText = [
      item.title,
      item.description,
      item.content,
      ...(item.keywords || [])
    ].join(' ').toLowerCase();
    
    return searchText.includes(lowercaseQuery);
  }).sort((a, b) => {
    // Prioritize title matches over description/content matches
    const aInTitle = a.title.toLowerCase().includes(lowercaseQuery);
    const bInTitle = b.title.toLowerCase().includes(lowercaseQuery);
    
    if (aInTitle && !bInTitle) return -1;
    if (!aInTitle && bInTitle) return 1;
    
    return 0;
  });
};

export function useSearchable({
  id,
  category,
  items = [],
  searchFn = defaultSearchFn,
  priority = 0,
}: UseSearchableOptions) {
  const { registerProvider, unregisterProvider } = useSearchContext();

  const provider: SearchProvider = useMemo(() => ({
    id,
    name: id,
    category,
    priority,
    search: (query: string) => searchFn(query, items),
  }), [id, category, priority, searchFn, items]);

  useEffect(() => {
    registerProvider(provider);
    
    return () => {
      unregisterProvider(id);
    };
  }, [provider, registerProvider, unregisterProvider, id]);

  const updateItems = useCallback((newItems: SearchableItem[]) => {
    const updatedProvider: SearchProvider = {
      ...provider,
      search: (query: string) => searchFn(query, newItems),
    };
    registerProvider(updatedProvider);
  }, [provider, searchFn, registerProvider]);

  return { updateItems };
}

// Hook for creating searchable items from component props
export function useSearchableItems(
  baseId: string,
  category: string,
  itemsData: any[],
  itemMapper: (item: any, index: number) => Partial<SearchableItem>
): SearchableItem[] {
  return useMemo(() => {
    return itemsData.map((item, index) => {
      const mapped = itemMapper(item, index);
      return {
        id: `${baseId}-${index}`,
        title: '',
        description: '',
        category,
        ...mapped,
      } as SearchableItem;
    });
  }, [baseId, category, itemsData, itemMapper]);
}