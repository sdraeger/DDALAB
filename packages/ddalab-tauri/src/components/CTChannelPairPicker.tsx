"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

interface CTChannelPairPickerProps {
  channels: string[];
  onPairAdded: (channel1: string, channel2: string) => void;
  disabled?: boolean;
}

export function CTChannelPairPicker({
  channels,
  onPairAdded,
  disabled,
}: CTChannelPairPickerProps) {
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
      // Second channel selected - create pair
      const ch1 = selectedChannels[0];
      const ch2 = channel;
      onPairAdded(ch1, ch2);
      setSelectedChannels([null, null]); // Reset selection
    }
  };

  const getChannelState = (channel: string): "idle" | "first" | "second" => {
    if (selectedChannels[0] === channel) return "first";
    if (selectedChannels[1] === channel) return "second";
    return "idle";
  };

  return (
    <div className="space-y-2">
      {/* Selection status */}
      <div className="flex items-center gap-2 text-sm">
        {selectedChannels[0] && (
          <Badge variant="default" className="bg-blue-600">
            1st: {selectedChannels[0]}
          </Badge>
        )}
        {selectedChannels[1] && (
          <Badge variant="default" className="bg-green-600">
            2nd: {selectedChannels[1]}
          </Badge>
        )}
        {selectedChannels[0] === null && (
          <span className="text-muted-foreground">Select first channel...</span>
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
          >
            <X className="h-3 w-3" />
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
                  state === "first"
                    ? "bg-blue-600 hover:bg-blue-700"
                    : state === "second"
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
          ? `Click another channel to create pair: ${selectedChannels[0]} ⟷ ?`
          : "Click any channel to start selecting a pair"}
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
