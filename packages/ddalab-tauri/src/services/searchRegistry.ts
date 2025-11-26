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

type RegistryListener = () => void;

class SearchRegistry {
  private items: Map<string, SearchableItem> = new Map();
  private listeners: Set<RegistryListener> = new Set();

  /**
   * Register a searchable item
   * @returns Cleanup function to unregister
   */
  register(item: SearchableItem): () => void {
    this.items.set(item.id, item);
    this.notifyListeners();

    return () => {
      this.items.delete(item.id);
      this.notifyListeners();
    };
  }

  /**
   * Register multiple items at once
   * @returns Cleanup function to unregister all
   */
  registerMany(items: SearchableItem[]): () => void {
    items.forEach((item) => this.items.set(item.id, item));
    this.notifyListeners();

    return () => {
      items.forEach((item) => this.items.delete(item.id));
      this.notifyListeners();
    };
  }

  /**
   * Update an existing item (or register if new)
   */
  update(id: string, updates: Partial<SearchableItem>): void {
    const existing = this.items.get(id);
    if (existing) {
      this.items.set(id, { ...existing, ...updates });
      this.notifyListeners();
    }
  }

  /**
   * Unregister an item by ID
   */
  unregister(id: string): void {
    if (this.items.delete(id)) {
      this.notifyListeners();
    }
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
   * Search registered items
   */
  search(query: string): SearchResult[] {
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];

    this.items.forEach((item) => {
      const matchesTitle = item.title.toLowerCase().includes(lowerQuery);
      const matchesSubtitle = item.subtitle?.toLowerCase().includes(lowerQuery);
      const matchesDescription = item.description
        ?.toLowerCase()
        .includes(lowerQuery);
      const matchesKeywords = item.keywords?.some((kw) =>
        kw.toLowerCase().includes(lowerQuery),
      );
      const matchesCategory = item.category?.toLowerCase().includes(lowerQuery);

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
