import { SearchProvider, SearchResult, SearchOptions } from "@/types/search";
import { getAllSearchProviders } from "./searchProviders";

export class SearchService {
  private providers: SearchProvider[];

  constructor(providers?: SearchProvider[]) {
    this.providers = providers || getAllSearchProviders();
  }

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmedQuery = query.trim();
    const limit = options.limit || 50;
    const types = options.types;

    const allResults: SearchResult[] = [];

    for (const provider of this.providers) {
      try {
        const results = await Promise.resolve(provider.search(trimmedQuery));
        allResults.push(...results);
      } catch (error) {
        console.error(`Error in search provider ${provider.name}:`, error);
      }
    }

    let filteredResults = allResults;

    if (types && types.length > 0) {
      filteredResults = allResults.filter((result) =>
        types.includes(result.type)
      );
    }

    const scoredResults = this.scoreResults(filteredResults, trimmedQuery);

    return scoredResults.slice(0, limit);
  }

  private scoreResults(
    results: SearchResult[],
    query: string
  ): SearchResult[] {
    const lowerQuery = query.toLowerCase();

    const scored = results.map((result) => {
      let score = 0;

      const titleMatch = result.title.toLowerCase().indexOf(lowerQuery);
      if (titleMatch === 0) {
        score += 100;
      } else if (titleMatch > 0) {
        score += 50;
      }

      if (result.subtitle?.toLowerCase().includes(lowerQuery)) {
        score += 30;
      }

      if (result.description?.toLowerCase().includes(lowerQuery)) {
        score += 20;
      }

      if (
        result.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery))
      ) {
        score += 10;
      }

      const exactTitleMatch =
        result.title.toLowerCase() === lowerQuery ||
        result.title.toLowerCase().replace(/[^a-z0-9]/g, "") ===
          lowerQuery.replace(/[^a-z0-9]/g, "");
      if (exactTitleMatch) {
        score += 200;
      }

      return { result, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.map((item) => item.result);
  }

  addProvider(provider: SearchProvider): void {
    this.providers.push(provider);
  }

  removeProvider(providerName: string): void {
    this.providers = this.providers.filter((p) => p.name !== providerName);
  }
}

let searchServiceInstance: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!searchServiceInstance) {
    searchServiceInstance = new SearchService();
  }
  return searchServiceInstance;
}
