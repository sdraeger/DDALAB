"use client";

import { useState, useEffect, createContext, useContext } from "react";
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

export function GlobalSearchProvider() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value: SearchContextType = {
    openSearch: () => setOpen(true),
    closeSearch: () => setOpen(false),
    toggleSearch: () => setOpen((prev) => !prev),
  };

  return (
    <SearchContext.Provider value={value}>
      <GlobalSearch open={open} onOpenChange={setOpen} />
    </SearchContext.Provider>
  );
}
