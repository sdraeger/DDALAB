"use client";

import {
  useState,
  createContext,
  useContext,
  useCallback,
  useMemo,
} from "react";
import { GlobalSearch } from "./GlobalSearch";

interface SearchContextType {
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
}

const SearchContext = createContext<SearchContextType | null>(null);

export function useGlobalSearch() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error("useGlobalSearch must be used within GlobalSearchProvider");
  }
  return context;
}

export function GlobalSearchProvider({
  children,
}: {
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const openSearch = useCallback(() => setOpen(true), []);
  const closeSearch = useCallback(() => setOpen(false), []);
  const toggleSearch = useCallback(() => setOpen((prev) => !prev), []);

  const value = useMemo<SearchContextType>(
    () => ({
      openSearch,
      closeSearch,
      toggleSearch,
    }),
    [openSearch, closeSearch, toggleSearch],
  );

  return (
    <SearchContext.Provider value={value}>
      {children}
      <GlobalSearch open={open} onOpenChange={setOpen} />
    </SearchContext.Provider>
  );
}
