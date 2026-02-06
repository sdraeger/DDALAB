/**
 * Search Registry - Allows components to dynamically register searchable items
 *
 * Usage in components:
 * ```tsx
 * import { useSearchable } from "@/hooks/useSearchable";
 *
 * function MyComponent() {
 *   useSearchable({
 *     id: "my-feature-item",
 *     type: "action",
 *     title: "My Feature",
 *     description: "Does something useful",
 *     category: "Features",
 *     keywords: ["feature", "useful", "tool"],
 *     action: () => { navigateToFeature(); }
 *   });
 *
 *   return <div>...</div>;
 * }
 * ```
 */

import { SearchResult, SearchResultType, SearchProvider } from "@/types/search";

export interface SearchableItem {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  keywords?: string[];
  icon?: string;
  action: () => void | Promise<void>;
  metadata?: Record<string, any>;
  /** Priority for sorting (higher = more important, default 0) */
  priority?: number;
}

/**
 * Indexed item with pre-computed lowercase strings for O(1) comparison
 */
interface IndexedSearchableItem extends SearchableItem {
  _lowerTitle: string;
  _lowerSubtitle?: string;
  _lowerDescription?: string;
  _lowerKeywords?: string[];
  _lowerCategory?: string;
}

type RegistryListener = () => void;

/**
 * Create an indexed version of a searchable item with pre-computed lowercase strings
 */
function createIndexedItem(item: SearchableItem): IndexedSearchableItem {
  return {
    ...item,
    _lowerTitle: item.title.toLowerCase(),
    _lowerSubtitle: item.subtitle?.toLowerCase(),
    _lowerDescription: item.description?.toLowerCase(),
    _lowerKeywords: item.keywords?.map((kw) => kw.toLowerCase()),
    _lowerCategory: item.category?.toLowerCase(),
  };
}

class SearchRegistry {
  private items: Map<string, IndexedSearchableItem> = new Map();
  private listeners: Set<RegistryListener> = new Set();
  private searchCache: Map<
    string,
    { results: SearchResult[]; timestamp: number }
  > = new Map();
  private cacheMaxAge = 100; // Cache results for 100ms
  private cacheVersion = 0; // Incremented on item changes to invalidate cache

  /**
   * Register a searchable item
   * @returns Cleanup function to unregister
   */
  register(item: SearchableItem): () => void {
    this.items.set(item.id, createIndexedItem(item));
    this.invalidateCache();
    this.notifyListeners();

    return () => {
      this.items.delete(item.id);
      this.invalidateCache();
      this.notifyListeners();
    };
  }

  /**
   * Register multiple items at once
   * @returns Cleanup function to unregister all
   */
  registerMany(items: SearchableItem[]): () => void {
    items.forEach((item) => this.items.set(item.id, createIndexedItem(item)));
    this.invalidateCache();
    this.notifyListeners();

    return () => {
      items.forEach((item) => this.items.delete(item.id));
      this.invalidateCache();
      this.notifyListeners();
    };
  }

  /**
   * Update an existing item (or register if new)
   */
  update(id: string, updates: Partial<SearchableItem>): void {
    const existing = this.items.get(id);
    if (existing) {
      this.items.set(id, createIndexedItem({ ...existing, ...updates }));
      this.invalidateCache();
      this.notifyListeners();
    }
  }

  /**
   * Unregister an item by ID
   */
  unregister(id: string): void {
    if (this.items.delete(id)) {
      this.invalidateCache();
      this.notifyListeners();
    }
  }

  /**
   * Invalidate the search cache
   */
  private invalidateCache(): void {
    this.cacheVersion++;
    this.searchCache.clear();
  }

  /**
   * Get all registered items
   */
  getAll(): SearchableItem[] {
    return Array.from(this.items.values());
  }

  /**
   * Get items by category
   */
  getByCategory(category: string): SearchableItem[] {
    return Array.from(this.items.values()).filter(
      (item) => item.category === category,
    );
  }

  /**
   * Get items by type
   */
  getByType(type: SearchResultType): SearchableItem[] {
    return Array.from(this.items.values()).filter((item) => item.type === type);
  }

  /**
   * Search registered items using pre-computed lowercase strings
   * Uses caching to avoid redundant searches within debounce window
   */
  search(query: string): SearchResult[] {
    const lowerQuery = query.toLowerCase();

    // Check cache first
    const cacheKey = `${this.cacheVersion}:${lowerQuery}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.results;
    }

    const results: SearchResult[] = [];

    this.items.forEach((item) => {
      // Use pre-computed lowercase strings - no .toLowerCase() calls during search
      const matchesTitle = item._lowerTitle.includes(lowerQuery);
      const matchesSubtitle = item._lowerSubtitle?.includes(lowerQuery);
      const matchesDescription = item._lowerDescription?.includes(lowerQuery);
      const matchesKeywords = item._lowerKeywords?.some((kw) =>
        kw.includes(lowerQuery),
      );
      const matchesCategory = item._lowerCategory?.includes(lowerQuery);

      if (
        matchesTitle ||
        matchesSubtitle ||
        matchesDescription ||
        matchesKeywords ||
        matchesCategory
      ) {
        results.push({
          id: item.id,
          type: item.type,
          title: item.title,
          subtitle: item.subtitle,
          description: item.description,
          category: item.category,
          keywords: item.keywords,
          icon: item.icon,
          action: item.action,
          metadata: { ...item.metadata, priority: item.priority || 0 },
        });
      }
    });

    // Sort by priority (higher first)
    results.sort((a, b) => {
      const priorityA = (a.metadata?.priority as number) || 0;
      const priorityB = (b.metadata?.priority as number) || 0;
      return priorityB - priorityA;
    });

    // Cache the results
    this.searchCache.set(cacheKey, { results, timestamp: Date.now() });

    return results;
  }

  /**
   * Subscribe to registry changes
   */
  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Clear all registered items
   */
  clear(): void {
    this.items.clear();
    this.notifyListeners();
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    this.items.forEach((item) => {
      byType[item.type] = (byType[item.type] || 0) + 1;
      if (item.category) {
        byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      }
    });

    return {
      total: this.items.size,
      byType,
      byCategory,
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }
}

// Singleton instance
let registryInstance: SearchRegistry | null = null;

export function getSearchRegistry(): SearchRegistry {
  if (!registryInstance) {
    registryInstance = new SearchRegistry();
  }
  return registryInstance;
}

/**
 * Search provider that uses the registry
 */
export class RegisteredItemsSearchProvider implements SearchProvider {
  name = "RegisteredItems";

  search(query: string): SearchResult[] {
    return getSearchRegistry().search(query);
  }
}
