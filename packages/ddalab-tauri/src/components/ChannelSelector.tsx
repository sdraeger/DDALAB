import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent } from "./ui/card";
import { Search, X, CheckSquare, Square, Zap } from "lucide-react";

export interface ChannelSelectorProps {
  channels: string[];
  selectedChannels: string[];
  onSelectionChange: (channels: string[]) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  maxHeight?: string;
  showSelectAll?: boolean;
  showSearch?: boolean;
  placeholder?: string;
  variant?: "default" | "compact";
}

export function ChannelSelector({
  channels,
  selectedChannels,
  onSelectionChange,
  disabled = false,
  label = "Channels",
  description,
  maxHeight = "max-h-64",
  showSelectAll = true,
  showSearch = true,
  placeholder = "Search channels...",
  variant = "default",
}: ChannelSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const badgeRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;

    const query = searchQuery.toLowerCase();
    return channels.filter((channel) => channel.toLowerCase().includes(query));
  }, [channels, searchQuery]);

  // Reset focus when filtered channels change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [filteredChannels.length]);

  // Focus the badge element when focusedIndex changes
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < filteredChannels.length) {
      const badge = badgeRefs.current.get(focusedIndex);
      badge?.focus();
    }
  }, [focusedIndex, filteredChannels.length]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled || filteredChannels.length === 0) return;

      const { key } = event;
      let newIndex = focusedIndex;

      switch (key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          newIndex =
            focusedIndex < filteredChannels.length - 1 ? focusedIndex + 1 : 0;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          newIndex =
            focusedIndex > 0 ? focusedIndex - 1 : filteredChannels.length - 1;
          break;
        case "Home":
          event.preventDefault();
          newIndex = 0;
          break;
        case "End":
          event.preventDefault();
          newIndex = filteredChannels.length - 1;
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < filteredChannels.length) {
            handleToggle(filteredChannels[focusedIndex]);
          }
          return;
        case "a":
          // Ctrl+A to select all
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            handleSelectAll();
          }
          return;
        default:
          return;
      }

      setFocusedIndex(newIndex);
    },
    [disabled, filteredChannels, focusedIndex],
  );

  const setBadgeRef = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      if (el) {
        badgeRefs.current.set(index, el);
      } else {
        badgeRefs.current.delete(index);
      }
    },
    [],
  );

  const handleToggle = (channel: string) => {
    if (disabled) return;

    const newSelection = selectedChannels.includes(channel)
      ? selectedChannels.filter((ch) => ch !== channel)
      : [...selectedChannels, channel];

    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onSelectionChange(filteredChannels);
  };

  const handleDeselectAll = () => {
    if (disabled) return;
    const remainingChannels = selectedChannels.filter(
      (ch) => !filteredChannels.includes(ch),
    );
    onSelectionChange(remainingChannels);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const allFilteredSelected =
    filteredChannels.length > 0 &&
    filteredChannels.every((ch) => selectedChannels.includes(ch));
  const someFilteredSelected = filteredChannels.some((ch) =>
    selectedChannels.includes(ch),
  );

  if (variant === "compact") {
    return (
      <div className="space-y-2">
        {showSearch && (
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={disabled}
              className="pl-8 pr-8 h-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-7 w-7 p-0"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {selectedChannels.length} of {channels.length} selected
            {searchQuery && ` (${filteredChannels.length} filtered)`}
          </span>
          {showSelectAll && filteredChannels.length > 0 && (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                disabled={disabled || allFilteredSelected}
                className="h-7 px-2 text-xs"
              >
                <CheckSquare className="h-3 w-3 mr-1" />
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeselectAll}
                disabled={disabled || !someFilteredSelected}
                className="h-7 px-2 text-xs"
              >
                <Square className="h-3 w-3 mr-1" />
                None
              </Button>
            </div>
          )}
        </div>

        <div
          ref={listContainerRef}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          tabIndex={filteredChannels.length > 0 && !disabled ? 0 : -1}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            // Only set initial focus if focusing the container itself
            if (e.target === listContainerRef.current && focusedIndex === -1) {
              setFocusedIndex(0);
            }
          }}
          className={`flex flex-wrap gap-2 ${maxHeight} overflow-y-auto p-2 border rounded-md ${disabled ? "opacity-50" : ""} focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
        >
          {filteredChannels.length > 0 ? (
            filteredChannels.map((channel, index) => {
              const isSelected = selectedChannels.includes(channel);
              const isFocused = focusedIndex === index;
              return (
                <button
                  key={channel}
                  ref={setBadgeRef(index)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={isFocused ? 0 : -1}
                  onClick={() => {
                    setFocusedIndex(index);
                    handleToggle(channel);
                  }}
                  onFocus={() => setFocusedIndex(index)}
                  disabled={disabled}
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                    isSelected
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                  } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:brightness-90"}`}
                >
                  {channel}
                </button>
              );
            })
          ) : (
            <div className="w-full text-center text-sm text-muted-foreground py-4">
              {searchQuery
                ? "No channels match your search"
                : "No channels available"}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <Label className="text-base font-medium">
              {label}
              <span className="text-muted-foreground font-normal ml-2">
                ({selectedChannels.length} of {channels.length} selected)
              </span>
            </Label>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
          {showSelectAll && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={disabled || allFilteredSelected}
                className="h-8"
              >
                <CheckSquare className="h-4 w-4 mr-1" />
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeselectAll}
                disabled={disabled || !someFilteredSelected}
                className="h-8"
              >
                <Square className="h-4 w-4 mr-1" />
                Deselect All
              </Button>
            </div>
          )}
        </div>

        {showSearch && (
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={disabled}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-8 w-8 p-0"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}

        {searchQuery && (
          <div className="text-sm text-muted-foreground">
            Showing {filteredChannels.length} of {channels.length} channels
          </div>
        )}

        <div
          ref={listContainerRef}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          tabIndex={filteredChannels.length > 0 && !disabled ? 0 : -1}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            // Only set initial focus if focusing the container itself
            if (e.target === listContainerRef.current && focusedIndex === -1) {
              setFocusedIndex(0);
            }
          }}
          className={`flex flex-wrap gap-2 ${maxHeight} overflow-y-auto p-3 border rounded-md bg-muted/30 ${disabled ? "opacity-50" : ""} focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
        >
          {filteredChannels.length > 0 ? (
            filteredChannels.map((channel, index) => {
              const isSelected = selectedChannels.includes(channel);
              const isFocused = focusedIndex === index;
              return (
                <button
                  key={channel}
                  ref={setBadgeRef(index)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={isFocused ? 0 : -1}
                  onClick={() => {
                    setFocusedIndex(index);
                    handleToggle(channel);
                  }}
                  onFocus={() => setFocusedIndex(index)}
                  disabled={disabled}
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                    isSelected
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                  } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:brightness-90 hover:shadow-sm"}`}
                >
                  {channel}
                </button>
              );
            })
          ) : (
            <div className="w-full text-center text-sm text-muted-foreground py-8">
              {searchQuery ? (
                <>
                  No channels match{" "}
                  <span className="font-medium">&quot;{searchQuery}&quot;</span>
                </>
              ) : (
                "No channels available"
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default ChannelSelector;
