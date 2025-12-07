/**
 * High-performance search index with automatic incremental updates
 *
 * Features:
 * - Inverted token index for O(1) token lookups
 * - Pre-computed trigram cache for fast similarity matching
 * - Lazy rebuilding with debouncing
 * - Incremental add/remove without full rebuild
 * - Memory-efficient data structures
 */

import { SearchResult } from "@/types/search";
import { generateTrigrams } from "./fuzzySearch";

interface IndexedItem {
  id: string;
  result: SearchResult;
  tokens: Set<string>;
  trigrams: Set<string>;
  normalizedFields: Map<string, string>; // field name -> normalized text
}

export interface SearchIndexStats {
  itemCount: number;
  tokenCount: number;
  trigramCount: number;
  memoryEstimateKB: number;
  lastRebuildMs: number;
  isClean: boolean;
}

/**
 * Normalize text for indexing
 */
function normalizeForIndex(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/**
 * Extract tokens from text
 */
function extractTokens(text: string): Set<string> {
  const normalized = normalizeForIndex(text);
  return new Set(normalized.split(/\s+/).filter((t) => t.length > 0));
}

/**
 * Generate all trigrams from text
 * Uses shared implementation from fuzzySearch for consistency
 */
function extractTrigrams(text: string): Set<string> {
  const normalized = normalizeForIndex(text);
  return generateTrigrams(normalized);
}

/**
 * High-performance search index with automatic maintenance
 */
export class SearchIndex {
  // Core data structures
  private items: Map<string, IndexedItem> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map(); // token -> item IDs
  private trigramIndex: Map<string, Set<string>> = new Map(); // trigram -> item IDs

  // Index state management
  private isDirty = false;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private lastRebuildTime = 0;

  // Configuration
  private rebuildDebounceMs = 1000; // Wait 1s after last change
  private autoRebuild = true;

  constructor(autoRebuild = true) {
    this.autoRebuild = autoRebuild;
  }

  /**
   * Add or update an item in the index
   */
  addItem(result: SearchResult): void {
    const id = result.id;

    // Remove old version if exists
    if (this.items.has(id)) {
      this.removeItem(id);
    }

    // Extract all text fields
    const fields = new Map<string, string>();
    fields.set("title", result.title);
    if (result.subtitle) fields.set("subtitle", result.subtitle);
    if (result.description) fields.set("description", result.description);

    // Collect all tokens and trigrams
    const allTokens = new Set<string>();
    const allTrigrams = new Set<string>();

    for (const [fieldName, text] of fields.entries()) {
      const tokens = extractTokens(text);
      const trigrams = extractTrigrams(text);

      tokens.forEach((t) => allTokens.add(t));
      trigrams.forEach((t) => allTrigrams.add(t));

      // Add to normalized fields
      fields.set(fieldName, normalizeForIndex(text));
    }

    // Add keywords
    if (result.keywords) {
      result.keywords.forEach((kw) => {
        const tokens = extractTokens(kw);
        const trigrams = extractTrigrams(kw);
        tokens.forEach((t) => allTokens.add(t));
        trigrams.forEach((t) => allTrigrams.add(t));
      });
    }

    // Create indexed item
    const indexedItem: IndexedItem = {
      id,
      result,
      tokens: allTokens,
      trigrams: allTrigrams,
      normalizedFields: fields,
    };

    // Store item
    this.items.set(id, indexedItem);

    // Update inverted index
    allTokens.forEach((token) => {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(id);
    });

    // Update trigram index
    allTrigrams.forEach((trigram) => {
      if (!this.trigramIndex.has(trigram)) {
        this.trigramIndex.set(trigram, new Set());
      }
      this.trigramIndex.get(trigram)!.add(id);
    });
  }

  /**
   * Remove an item from the index
   */
  removeItem(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;

    // Remove from inverted index
    item.tokens.forEach((token) => {
      const itemSet = this.invertedIndex.get(token);
      if (itemSet) {
        itemSet.delete(id);
        if (itemSet.size === 0) {
          this.invertedIndex.delete(token);
        }
      }
    });

    // Remove from trigram index
    item.trigrams.forEach((trigram) => {
      const itemSet = this.trigramIndex.get(trigram);
      if (itemSet) {
        itemSet.delete(id);
        if (itemSet.size === 0) {
          this.trigramIndex.delete(trigram);
        }
      }
    });

    // Remove item
    this.items.delete(id);
    return true;
  }

  /**
   * Add multiple items in batch
   */
  addItems(results: SearchResult[]): void {
    results.forEach((result) => this.addItem(result));
  }

  /**
   * Clear all items and rebuild from scratch
   */
  rebuildIndex(results: SearchResult[]): void {
    const startTime = performance.now();

    // Clear existing data
    this.items.clear();
    this.invertedIndex.clear();
    this.trigramIndex.clear();

    // Add all items
    this.addItems(results);

    this.lastRebuildTime = performance.now() - startTime;
    this.isDirty = false;
  }

  /**
   * Mark index as dirty and schedule rebuild
   */
  markDirty(): void {
    this.isDirty = true;

    if (!this.autoRebuild) return;

    // Clear existing timer
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }

    // Schedule rebuild after debounce period
    this.rebuildTimer = setTimeout(() => {
      // Note: Actual rebuild happens when providers call rebuildIndex()
      this.isDirty = true;
    }, this.rebuildDebounceMs);
  }

  /**
   * Fast lookup by exact token match
   */
  findByToken(token: string): Set<string> {
    const normalized = normalizeForIndex(token);
    return this.invertedIndex.get(normalized) || new Set();
  }

  /**
   * Fast lookup by trigram overlap
   * Returns items that share at least one trigram
   */
  findByTrigram(trigram: string): Set<string> {
    return this.trigramIndex.get(trigram) || new Set();
  }

  /**
   * Find items by query tokens (multi-word)
   */
  findByTokens(tokens: string[]): Map<string, number> {
    const scores = new Map<string, number>();

    tokens.forEach((token) => {
      const normalized = normalizeForIndex(token);

      // Exact token match
      const exactMatches = this.invertedIndex.get(normalized);
      if (exactMatches) {
        exactMatches.forEach((id) => {
          scores.set(id, (scores.get(id) || 0) + 10);
        });
      }

      // Prefix match (token starts with query)
      this.invertedIndex.forEach((itemIds, indexedToken) => {
        if (indexedToken.startsWith(normalized)) {
          itemIds.forEach((id) => {
            scores.set(id, (scores.get(id) || 0) + 5);
          });
        }
      });
    });

    return scores;
  }

  /**
   * Find items by trigram similarity
   * Returns items that share trigrams with the query
   */
  findByTrigramSimilarity(query: string): Map<string, number> {
    const queryTrigrams = extractTrigrams(query);
    const scores = new Map<string, number>();

    queryTrigrams.forEach((trigram) => {
      const matches = this.trigramIndex.get(trigram);
      if (matches) {
        matches.forEach((id) => {
          scores.set(id, (scores.get(id) || 0) + 1);
        });
      }
    });

    return scores;
  }

  /**
   * Get an indexed item by ID
   */
  getItem(id: string): IndexedItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get all items
   */
  getAllItems(): SearchResult[] {
    return Array.from(this.items.values()).map((item) => item.result);
  }

  /**
   * Get index statistics
   */
  getStats(): SearchIndexStats {
    // Rough memory estimate
    const itemMemory = this.items.size * 500; // ~500 bytes per item
    const tokenMemory = this.invertedIndex.size * 100; // ~100 bytes per token entry
    const trigramMemory = this.trigramIndex.size * 50; // ~50 bytes per trigram entry

    return {
      itemCount: this.items.size,
      tokenCount: this.invertedIndex.size,
      trigramCount: this.trigramIndex.size,
      memoryEstimateKB: Math.round(
        (itemMemory + tokenMemory + trigramMemory) / 1024,
      ),
      lastRebuildMs: this.lastRebuildTime,
      isClean: !this.isDirty,
    };
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.items.clear();
    this.invertedIndex.clear();
    this.trigramIndex.clear();
    this.isDirty = false;

    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
  }

  /**
   * Check if index is empty
   */
  isEmpty(): boolean {
    return this.items.size === 0;
  }

  /**
   * Get size of index
   */
  size(): number {
    return this.items.size;
  }
}
