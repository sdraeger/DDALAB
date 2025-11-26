"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSearchService } from "@/services/searchService";
import { SearchResult } from "@/types/search";
import {
  Home,
  BarChart3,
  Brain,
  Settings,
  Bell,
  File,
  Radio,
  Play,
  FolderOpen,
  Palette,
  PanelLeft,
  Search,
  ArrowRight,
  Command,
} from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, any> = {
  Home,
  BarChart3,
  Brain,
  Settings,
  Bell,
  File,
  Radio,
  Play,
  FolderOpen,
  Palette,
  PanelLeft,
  Search,
};

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchService = getSearchService();

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setSelectedIndex(0);
        return;
      }

      setIsSearching(true);
      try {
        const searchResults = await searchService.search(searchQuery, {
          limit: 50,
        });
        setResults(searchResults);
        setSelectedIndex(0);
      } catch (error) {
        console.error("Search error:", error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [searchService],
  );

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      performSearch(query);
    }, 150);

    return () => clearTimeout(debounceTimer);
  }, [query, performSearch]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      executeAction(results[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  const executeAction = async (result: SearchResult) => {
    try {
      await result.action();
      onOpenChange(false);
      setQuery("");
      setResults([]);
    } catch (error) {
      console.error("Error executing action:", error);
    }
  };

  const getCategoryColor = (type: string): string => {
    switch (type) {
      case "navigation":
        return "text-blue-500";
      case "settings":
        return "text-purple-500";
      case "file":
        return "text-green-500";
      case "analysis":
        return "text-orange-500";
      case "channel":
        return "text-cyan-500";
      case "action":
        return "text-pink-500";
      default:
        return "text-gray-500";
    }
  };

  const groupedResults = results.reduce(
    (acc, result) => {
      const category = result.category || "Other";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(result);
      return acc;
    },
    {} as Record<string, SearchResult[]>,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-muted-foreground" />
            <DialogTitle className="text-base font-normal">
              Search DDALAB
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-4 border-b">
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search for navigation, settings, files, analysis..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-base h-12"
            autoComplete="off"
          />
        </div>

        <ScrollArea className="max-h-[400px]">
          {isSearching ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {query.trim()
                  ? "No results found"
                  : "Type to search across DDALAB"}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Try searching for navigation tabs, settings, files, or actions
              </p>
              {/* Keyboard hints in empty state */}
              <div className="mt-6 flex items-center justify-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <kbd className="px-2 py-1 rounded bg-muted border text-[10px] font-mono">
                    ↑
                  </kbd>
                  <kbd className="px-2 py-1 rounded bg-muted border text-[10px] font-mono">
                    ↓
                  </kbd>
                  <span>to navigate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="px-2 py-1 rounded bg-muted border text-[10px] font-mono">
                    Enter
                  </kbd>
                  <span>to select</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="px-2 py-1 rounded bg-muted border text-[10px] font-mono">
                    Esc
                  </kbd>
                  <span>to close</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-2">
              {Object.entries(groupedResults).map(([category, items]) => (
                <div key={category} className="mb-2">
                  <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {category}
                  </div>
                  {items.map((result, index) => {
                    const globalIndex = results.indexOf(result);
                    const isSelected = globalIndex === selectedIndex;
                    const Icon = iconMap[result.icon || "Search"] || Search;

                    return (
                      <button
                        key={result.id}
                        onClick={() => executeAction(result)}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className={cn(
                          "w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors",
                          "hover:bg-accent",
                          isSelected && "bg-accent",
                        )}
                      >
                        <div
                          className={cn(
                            "mt-0.5 flex-shrink-0",
                            getCategoryColor(result.type),
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {result.title}
                            </span>
                            {result.subtitle && (
                              <>
                                <span className="text-muted-foreground">/</span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {result.subtitle}
                                </span>
                              </>
                            )}
                          </div>
                          {result.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {result.description}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="px-4 py-2 border-t bg-muted/50 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">
                ↑↓
              </kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">
                ↵
              </kbd>
              <span>Select</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">
                ESC
              </kbd>
              <span>Close</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Command className="h-3 w-3" />
            <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono">
              K
            </kbd>
            <span>to open</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
