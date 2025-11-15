import React, { useState, useMemo } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent } from "./ui/card";
import { Search, X, CheckSquare, Square } from "lucide-react";

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

  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;

    const query = searchQuery.toLowerCase();
    return channels.filter((channel) => channel.toLowerCase().includes(query));
  }, [channels, searchQuery]);

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
              >
                <X className="h-3 w-3" />
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
          className={`flex flex-wrap gap-2 ${maxHeight} overflow-y-auto p-2 border rounded-md ${disabled ? "opacity-50" : ""}`}
        >
          {filteredChannels.length > 0 ? (
            filteredChannels.map((channel) => (
              <Badge
                key={channel}
                variant={
                  selectedChannels.includes(channel) ? "default" : "outline"
                }
                className={`cursor-pointer transition-all ${disabled ? "cursor-not-allowed" : "hover:brightness-90"}`}
                onClick={() => handleToggle(channel)}
              >
                {channel}
              </Badge>
            ))
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
              >
                <X className="h-4 w-4" />
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
          className={`flex flex-wrap gap-2 ${maxHeight} overflow-y-auto p-3 border rounded-md bg-muted/30 ${disabled ? "opacity-50" : ""}`}
        >
          {filteredChannels.length > 0 ? (
            filteredChannels.map((channel) => (
              <Badge
                key={channel}
                variant={
                  selectedChannels.includes(channel) ? "default" : "outline"
                }
                className={`cursor-pointer transition-all ${disabled ? "cursor-not-allowed" : "hover:brightness-90 hover:shadow-sm"}`}
                onClick={() => handleToggle(channel)}
              >
                {channel}
              </Badge>
            ))
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
