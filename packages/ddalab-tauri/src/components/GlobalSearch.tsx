"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { getSearchService } from "@/services/searchService";
import { SearchResult } from "@/types/search";
import { useRecentFilesStore, getRelativeTime } from "@/store/recentFilesStore";
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
  Clock,
  History,
  Star,
  X,
  FileAudio,
  FileSpreadsheet,
  FileText,
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

// File type icons for recent files
const fileTypeIcons: Record<string, any> = {
  edf: FileAudio,
  csv: FileSpreadsheet,
  txt: FileText,
  ascii: FileText,
  vhdr: FileAudio,
  xdf: FileAudio,
  set: FileAudio,
  fif: FileAudio,
  nwb: FileAudio,
  default: File,
};

function getFileIcon(type: string) {
  return fileTypeIcons[type.toLowerCase()] || fileTypeIcons.default;
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const GlobalSearch = memo(function GlobalSearch({
  open,
  onOpenChange,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchService = getSearchService();

  // Recent files and search history from store
  const recentFiles = useRecentFilesStore((s) => s.recentFiles);
  const favorites = useRecentFilesStore((s) => s.favorites);
  const searchHistory = useRecentFilesStore((s) => s.searchHistory);
  const addSearchQuery = useRecentFilesStore((s) => s.addSearchQuery);
  const clearSearchHistory = useRecentFilesStore((s) => s.clearSearchHistory);
  const getSearchSuggestions = useRecentFilesStore(
    (s) => s.getSearchSuggestions,
  );

  // Search suggestions based on partial query
  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    return getSearchSuggestions(query);
  }, [query, getSearchSuggestions]);

  // Recent items to show when no query
  const recentItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: "history" | "file" | "favorite";
      title: string;
      subtitle?: string;
      timestamp?: number;
      fileType?: string;
      path?: string;
    }> = [];

    // Add favorites first
    favorites.slice(0, 3).forEach((f) => {
      items.push({
        id: `fav-${f.path}`,
        type: "favorite",
        title: f.name,
        subtitle: f.path,
        fileType: f.type,
        path: f.path,
      });
    });

    // Add recent files
    recentFiles.slice(0, 5).forEach((f) => {
      if (!items.find((i) => i.path === f.path)) {
        items.push({
          id: `file-${f.path}`,
          type: "file",
          title: f.name,
          subtitle: f.path,
          timestamp: f.lastAccessed,
          fileType: f.type,
          path: f.path,
        });
      }
    });

    // Add search history
    searchHistory.slice(0, 5).forEach((q, idx) => {
      items.push({
        id: `history-${idx}`,
        type: "history",
        title: q,
      });
    });

    return items;
  }, [favorites, recentFiles, searchHistory]);

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
      // Save search query to history if there was one
      if (query.trim()) {
        addSearchQuery(query.trim());
      }
      await result.action();
      onOpenChange(false);
      setQuery("");
      setResults([]);
    } catch (error) {
      console.error("Error executing action:", error);
    }
  };

  // Handle clicking on a recent/history item
  const handleRecentItemClick = (item: (typeof recentItems)[0]) => {
    if (item.type === "history") {
      // Use as search query
      setQuery(item.title);
    } else if (item.path) {
      // This is a file - we could navigate to it or trigger file open
      // For now, search for it
      setQuery(item.title);
    }
  };

  // Handle clicking on a suggestion
  const handleSuggestionClick = (suggestion: string) => {
    setQuery(suggestion);
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
            <div className="py-2">
              {/* Show suggestions if typing */}
              {query.trim() && suggestions.length > 0 && (
                <div className="mb-2">
                  <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <History className="h-3 w-3" />
                    Suggestions
                  </div>
                  {suggestions.map((suggestion, idx) => (
                    <button
                      key={`suggestion-${idx}`}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-accent transition-colors duration-200"
                    >
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{suggestion}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* No results message */}
              {query.trim() && suggestions.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No results found
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Try a different search term
                  </p>
                </div>
              )}

              {/* Empty state with recent items */}
              {!query.trim() && (
                <>
                  {recentItems.length > 0 ? (
                    <>
                      {/* Favorites */}
                      {favorites.length > 0 && (
                        <div className="mb-2">
                          <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Star className="h-3 w-3 text-yellow-500" />
                            Favorites
                          </div>
                          {recentItems
                            .filter((i) => i.type === "favorite")
                            .map((item) => {
                              const FileIcon = item.fileType
                                ? getFileIcon(item.fileType)
                                : File;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleRecentItemClick(item)}
                                  className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-accent transition-colors duration-200"
                                >
                                  <FileIcon className="h-4 w-4 text-yellow-500" />
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm truncate block">
                                      {item.title}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      )}

                      {/* Recent files */}
                      {recentItems.filter((i) => i.type === "file").length >
                        0 && (
                        <div className="mb-2">
                          <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            Recent Files
                          </div>
                          {recentItems
                            .filter((i) => i.type === "file")
                            .map((item) => {
                              const FileIcon = item.fileType
                                ? getFileIcon(item.fileType)
                                : File;
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => handleRecentItemClick(item)}
                                  className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-accent transition-colors duration-200"
                                >
                                  <FileIcon className="h-4 w-4 text-green-500" />
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm truncate block">
                                      {item.title}
                                    </span>
                                    {item.timestamp && (
                                      <span className="text-xs text-muted-foreground">
                                        {getRelativeTime(item.timestamp)}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      )}

                      {/* Search history */}
                      {searchHistory.length > 0 && (
                        <div className="mb-2">
                          <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <History className="h-3 w-3" />
                              Recent Searches
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 text-[10px] px-1.5"
                              onClick={(e) => {
                                e.stopPropagation();
                                clearSearchHistory();
                              }}
                            >
                              Clear
                            </Button>
                          </div>
                          {recentItems
                            .filter((i) => i.type === "history")
                            .map((item) => (
                              <button
                                key={item.id}
                                onClick={() => handleRecentItemClick(item)}
                                className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-accent transition-colors duration-200"
                              >
                                <Search className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{item.title}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        Type to search across DDALAB
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Try searching for navigation tabs, settings, files, or
                        actions
                      </p>
                    </div>
                  )}

                  {/* Keyboard hints */}
                  <div className="mt-4 px-4 flex items-center justify-center gap-6 text-xs text-muted-foreground">
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
                </>
              )}
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
});
