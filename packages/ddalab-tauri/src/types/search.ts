export type SearchResultType =
  | "navigation"
  | "settings"
  | "file"
  | "analysis"
  | "notification"
  | "annotation"
  | "channel"
  | "action";

export interface SearchResult {
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
}

export interface SearchProvider {
  name: string;
  search: (query: string) => Promise<SearchResult[]> | SearchResult[];
}

export interface SearchOptions {
  limit?: number;
  types?: SearchResultType[];
  includeHidden?: boolean;
}
