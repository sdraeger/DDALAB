export interface SearchableItem {
  id: string;
  title: string;
  description: string;
  content?: string;
  keywords?: string[];
  category: string;
  componentId?: string;
  path?: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  metadata?: Record<string, any>;
}

export interface SearchProvider {
  id: string;
  name: string;
  category: string;
  search: (query: string) => Promise<SearchableItem[]> | SearchableItem[];
  priority?: number;
}

export interface SearchContext {
  providers: Map<string, SearchProvider>;
  registerProvider: (provider: SearchProvider) => void;
  unregisterProvider: (providerId: string) => void;
  search: (query: string) => Promise<SearchableItem[]>;
}

export interface UseSearchableOptions {
  id: string;
  category: string;
  items?: SearchableItem[];
  searchFn?: (query: string, items: SearchableItem[]) => SearchableItem[];
  priority?: number;
}