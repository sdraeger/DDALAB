"use client";

import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

interface ChannelSelectorUIProps {
  availableChannels: string[];
  selectedChannels: string[];
  onToggleChannel: (channel: string) => void;
  onSelectAllChannels: () => void;
  onClearAllChannels: () => void;
  isLoading?: boolean; // To show loading state for channels
  error?: Error | null; // To show error state for channels
}

export function ChannelSelectorUI({
  availableChannels,
  selectedChannels,
  onToggleChannel,
  onSelectAllChannels,
  onClearAllChannels,
  isLoading,
  error,
}: ChannelSelectorUIProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium mb-2">Channel Selection</h3>
      <div className="space-y-1 max-h-[250px] overflow-y-auto border rounded-md p-2 bg-muted/20">
        {error ? (
          <p className="text-center text-red-500 py-2">
            Error loading channels: {error.message}
          </p>
        ) : availableChannels.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {availableChannels.map((channel) => (
              <div key={channel} className="flex items-center">
                <Button
                  variant={
                    selectedChannels.includes(channel) ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => onToggleChannel(channel)}
                  className="w-full justify-start text-xs py-1 h-7 truncate"
                  title={channel}
                >
                  {channel}
                </Button>
              </div>
            ))}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-20">
            <Spinner />
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-2">
            No channels available
          </p>
        )}
      </div>

      {availableChannels.length > 0 && (
        <div className="flex gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onSelectAllChannels}
            className="flex-1 text-xs"
          >
            Select All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearAllChannels}
            className="flex-1 text-xs"
          >
            Clear All
          </Button>
        </div>
      )}
    </div>
  );
}
