"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

interface CDChannelPairPickerProps {
  channels: string[];
  onPairAdded: (fromChannel: string, toChannel: string) => void;
  disabled?: boolean;
}

export function CDChannelPairPicker({
  channels,
  onPairAdded,
  disabled,
}: CDChannelPairPickerProps) {
  const [selectedChannels, setSelectedChannels] = useState<
    [string | null, string | null]
  >([null, null]);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;

    const query = searchQuery.toLowerCase();
    return channels.filter((channel) => channel.toLowerCase().includes(query));
  }, [channels, searchQuery]);

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const handleChannelClick = (channel: string) => {
    if (disabled) return;

    // If this channel is already selected, deselect it
    if (selectedChannels[0] === channel) {
      setSelectedChannels([null, null]);
      return;
    }
    if (selectedChannels[1] === channel) {
      setSelectedChannels([selectedChannels[0], null]);
      return;
    }

    // Add to first empty slot
    if (selectedChannels[0] === null) {
      setSelectedChannels([channel, null]);
    } else if (selectedChannels[1] === null) {
      // Second channel selected - create directed pair (from -> to)
      const fromChannel = selectedChannels[0];
      const toChannel = channel;
      onPairAdded(fromChannel, toChannel);
      setSelectedChannels([null, null]); // Reset selection
    }
  };

  const getChannelState = (channel: string): "idle" | "from" | "to" => {
    if (selectedChannels[0] === channel) return "from";
    if (selectedChannels[1] === channel) return "to";
    return "idle";
  };

  return (
    <div className="space-y-2">
      {/* Selection status */}
      <div className="flex items-center gap-2 text-sm">
        {selectedChannels[0] && (
          <Badge variant="default" className="bg-blue-600">
            From: {selectedChannels[0]}
          </Badge>
        )}
        {selectedChannels[1] && (
          <Badge variant="default" className="bg-green-600">
            To: {selectedChannels[1]}
          </Badge>
        )}
        {selectedChannels[0] === null && (
          <span className="text-muted-foreground">
            Select source channel...
          </span>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search channels..."
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

      {searchQuery && (
        <div className="text-xs text-muted-foreground">
          Showing {filteredChannels.length} of {channels.length} channels
        </div>
      )}

      {/* Channel grid */}
      <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto p-2 border rounded-md">
        {filteredChannels.length > 0 ? (
          filteredChannels.map((channel) => {
            const state = getChannelState(channel);
            return (
              <Badge
                key={channel}
                variant={state === "idle" ? "outline" : "default"}
                className={`cursor-pointer text-center justify-center transition-colors ${
                  state === "from"
                    ? "bg-blue-600 hover:bg-blue-700"
                    : state === "to"
                      ? "bg-green-600 hover:bg-green-700"
                      : "hover:bg-accent"
                } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => handleChannelClick(channel)}
              >
                {channel}
              </Badge>
            );
          })
        ) : (
          <div className="col-span-6 text-center text-sm text-muted-foreground py-4">
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

      {/* Instructions */}
      <p className="text-xs text-muted-foreground">
        {selectedChannels[0]
          ? `Click target channel to create directed pair: ${selectedChannels[0]} → ?`
          : "Click source channel to start selecting a directed pair"}
      </p>

      {/* Reset button */}
      {selectedChannels[0] !== null && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedChannels([null, null])}
          disabled={disabled}
          className="w-full"
        >
          Cancel Selection
        </Button>
      )}
    </div>
  );
}
