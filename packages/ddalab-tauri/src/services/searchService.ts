import { SearchProvider, SearchResult, SearchOptions } from "@/types/search";
import { getAllSearchProviders } from "./searchProviders";
import { fuzzyMatchMultiField, FuzzyMatchOptions } from "./fuzzySearch";
import { SearchIndex } from "./searchIndex";

export class SearchService {
  private providers: SearchProvider[];
  private index: SearchIndex;
  private lastProviderResults: Map<string, SearchResult[]> = new Map();
  private indexRebuildPending = false;

  constructor(providers?: SearchProvider[]) {
    this.providers = providers || getAllSearchProviders();
    this.index = new SearchIndex(true); // Enable auto-rebuild
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmedQuery = query.trim();
    const limit = options.limit || 50;
    const types = options.types;

    // Collect results from providers
    const allResults: SearchResult[] = [];
    const currentProviderResults = new Map<string, SearchResult[]>();

    for (const provider of this.providers) {
      try {
        const results = await Promise.resolve(provider.search(trimmedQuery));
        allResults.push(...results);
        currentProviderResults.set(provider.name, results);
      } catch (error) {
        console.error(`Error in search provider ${provider.name}:`, error);
      }
    }

    // Update index if providers returned new/different results
    this.updateIndexIfNeeded(currentProviderResults);

    let filteredResults = allResults;

    if (types && types.length > 0) {
      filteredResults = allResults.filter((result) =>
        types.includes(result.type),
      );
    }

    // Use index-optimized scoring when index is populated
    const scoredResults = this.index.isEmpty()
      ? this.scoreResults(filteredResults, trimmedQuery)
      : this.scoreResultsWithIndex(filteredResults, trimmedQuery);

    return scoredResults.slice(0, limit);
  }

  /**
   * Update index if provider results have changed
   */
  private updateIndexIfNeeded(
    currentResults: Map<string, SearchResult[]>,
  ): void {
    // Check if results have changed
    let hasChanges = false;

    if (currentResults.size !== this.lastProviderResults.size) {
      hasChanges = true;
    } else {
      for (const [providerName, results] of currentResults.entries()) {
        const lastResults = this.lastProviderResults.get(providerName);
        if (!lastResults || lastResults.length !== results.length) {
          hasChanges = true;
          break;
        }
      }
    }

    if (hasChanges) {
      this.lastProviderResults = new Map(currentResults);
      this.scheduleIndexRebuild();
    }
  }

  /**
   * Schedule index rebuild (debounced)
   */
  private scheduleIndexRebuild(): void {
    if (this.indexRebuildPending) return;

    this.indexRebuildPending = true;

    // Rebuild on next tick to avoid blocking search
    setTimeout(() => {
      const allResults: SearchResult[] = [];
      for (const results of this.lastProviderResults.values()) {
        allResults.push(...results);
      }

      this.index.rebuildIndex(allResults);
      this.indexRebuildPending = false;
    }, 0);
  }

  /**
   * Score results using index-optimized lookups
   * Falls back to fuzzy matching for edge cases
   */
  private scoreResultsWithIndex(
    results: SearchResult[],
    query: string,
  ): SearchResult[] {
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 0);

    // Get index-based scores
    const tokenScores = this.index.findByTokens(queryTokens);
    const trigramScores = this.index.findByTrigramSimilarity(query);

    const fuzzyOptions: FuzzyMatchOptions = {
      maxEditDistance: 2,
      minTrigramSimilarity: 0.4,
      prefixBoost: true,
      exactMatchBoost: true,
      minTokenMatchRatio: 0.5,
    };

    const scored = results.map((result) => {
      let score = 0;

      // Start with index scores (fast path)
      const tokenScore = tokenScores.get(result.id) || 0;
      const trigramScore = trigramScores.get(result.id) || 0;

      score += tokenScore * 5; // Token matches are worth 5x
      score += trigramScore; // Trigram overlaps add to score

      // If no index match, fall back to full fuzzy matching
      if (score === 0) {
        const fields = [
          { text: result.title, weight: 3.0 },
          ...(result.subtitle ? [{ text: result.subtitle, weight: 2.0 }] : []),
          ...(result.description
            ? [{ text: result.description, weight: 1.5 }]
            : []),
          ...(result.keywords || []).map((kw) => ({ text: kw, weight: 1.0 })),
        ];

        const match = fuzzyMatchMultiField(query, fields, fuzzyOptions);
        score = match.score;
      }

      return {
        result,
        score,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.map((item) => item.result);
  }

  private scoreResults(results: SearchResult[], query: string): SearchResult[] {
    const fuzzyOptions: FuzzyMatchOptions = {
      maxEditDistance: 2,
      minTrigramSimilarity: 0.4,
      prefixBoost: true,
      exactMatchBoost: true,
      minTokenMatchRatio: 0.5,
    };

    const scored = results.map((result) => {
      // Build weighted fields for fuzzy matching
      const fields = [
        { text: result.title, weight: 3.0 }, // Title most important
        ...(result.subtitle ? [{ text: result.subtitle, weight: 2.0 }] : []),
        ...(result.description
          ? [{ text: result.description, weight: 1.5 }]
          : []),
        ...(result.keywords || []).map((kw) => ({ text: kw, weight: 1.0 })),
      ];

      const match = fuzzyMatchMultiField(query, fields, fuzzyOptions);

      return {
        result,
        score: match.score,
        matchType: match.matchType,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.map((item) => item.result);
  }

  addProvider(provider: SearchProvider): void {
    this.providers.push(provider);
    this.index.markDirty();
  }

  removeProvider(providerName: string): void {
    this.providers = this.providers.filter((p) => p.name !== providerName);
    this.index.markDirty();
  }

  /**
   * Get search index statistics for monitoring/debugging
   */
  getIndexStats() {
    return this.index.getStats();
  }

  /**
   * Force rebuild of the search index
   */
  rebuildIndex(): void {
    const allResults: SearchResult[] = [];
    for (const results of this.lastProviderResults.values()) {
      allResults.push(...results);
    }
    this.index.rebuildIndex(allResults);
  }

  /**
   * Clear the search index
   */
  clearIndex(): void {
    this.index.clear();
    this.lastProviderResults.clear();
  }
}

let searchServiceInstance: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!searchServiceInstance) {
    searchServiceInstance = new SearchService();
  }
  return searchServiceInstance;
}
