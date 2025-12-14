"use client";

import React, { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SearchableSetting {
  id: string;
  title: string;
  description?: string;
  keywords: string[];
  category: string;
  element: React.ReactNode;
}

export interface SettingsSearchProps {
  settings: SearchableSetting[];
  onSettingSelect?: (settingId: string) => void;
  placeholder?: string;
  className?: string;
}

export const SettingsSearch: React.FC<SettingsSearchProps> = ({
  settings,
  onSettingSelect,
  placeholder = "Search settings...",
  className = "",
}) => {
  const [query, setQuery] = useState("");

  const filteredSettings = useMemo(() => {
    if (!query.trim()) {
      return settings;
    }

    const lowerQuery = query.toLowerCase();
    return settings.filter((setting) => {
      return (
        setting.title.toLowerCase().includes(lowerQuery) ||
        setting.description?.toLowerCase().includes(lowerQuery) ||
        setting.keywords.some((keyword) =>
          keyword.toLowerCase().includes(lowerQuery),
        ) ||
        setting.category.toLowerCase().includes(lowerQuery)
      );
    });
  }, [settings, query]);

  const handleClear = () => {
    setQuery("");
  };

  const groupedSettings = useMemo(() => {
    const groups: Record<string, SearchableSetting[]> = {};
    filteredSettings.forEach((setting) => {
      if (!groups[setting.category]) {
        groups[setting.category] = [];
      }
      groups[setting.category].push(setting);
    });
    return groups;
  }, [filteredSettings]);

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 pr-10"
        />
        {query && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {query && (
        <p className="text-sm text-muted-foreground">
          Found {filteredSettings.length} setting
          {filteredSettings.length !== 1 ? "s" : ""}
          {filteredSettings.length === 0 && " - try different keywords"}
        </p>
      )}

      <div className="space-y-6">
        {Object.entries(groupedSettings).map(([category, categorySettings]) => (
          <div key={category}>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
              {category}
              <span className="ml-2 text-xs">({categorySettings.length})</span>
            </h3>
            <div className="space-y-3">
              {categorySettings.map((setting) => (
                <div
                  key={setting.id}
                  onClick={() => onSettingSelect?.(setting.id)}
                  className={`
                    p-4 rounded-lg border bg-card
                    ${query ? "ring-2 ring-primary/20" : ""}
                    ${onSettingSelect ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                  `}
                >
                  {setting.element}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {filteredSettings.length === 0 && query && (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">No settings found</p>
          <p className="text-sm text-muted-foreground">
            Try searching for: theme, data, analysis, or display
          </p>
        </div>
      )}
    </div>
  );
};

export function useSettingsSearch(settings: SearchableSetting[]) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredSettings = useMemo(() => {
    let filtered = settings;

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (setting) =>
          setting.title.toLowerCase().includes(lowerQuery) ||
          setting.description?.toLowerCase().includes(lowerQuery) ||
          setting.keywords.some((k) => k.toLowerCase().includes(lowerQuery)),
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter((s) => s.category === selectedCategory);
    }

    return filtered;
  }, [settings, searchQuery, selectedCategory]);

  const categories = useMemo(() => {
    return Array.from(new Set(settings.map((s) => s.category)));
  }, [settings]);

  return {
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    filteredSettings,
    categories,
  };
}
