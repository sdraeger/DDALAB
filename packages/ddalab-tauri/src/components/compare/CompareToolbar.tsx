"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChannelSelector } from "@/components/ChannelSelector";
import { LayoutGrid, LineChart, Table2 } from "lucide-react";
import type { ComparisonViewMode } from "@/store/slices/comparisonSlice";

interface CompareToolbarProps {
  viewMode: ComparisonViewMode;
  onViewModeChange: (mode: ComparisonViewMode) => void;
  activeVariantId: string;
  onVariantChange: (variantId: string) => void;
  availableVariants: Array<{ id: string; name: string }>;
  commonChannels: string[];
  selectedChannels: string[];
  onChannelsChange: (channels: string[]) => void;
}

const VIEW_MODES: Array<{
  id: ComparisonViewMode;
  label: string;
  icon: typeof Table2;
}> = [
  { id: "summary", label: "Summary", icon: Table2 },
  { id: "overlay", label: "Overlay", icon: LineChart },
  { id: "sideBySide", label: "Side by Side", icon: LayoutGrid },
];

export function CompareToolbar({
  viewMode,
  onViewModeChange,
  activeVariantId,
  onVariantChange,
  availableVariants,
  commonChannels,
  selectedChannels,
  onChannelsChange,
}: CompareToolbarProps) {
  const handleChannelsChange = useCallback(
    (channels: string[]) => {
      onChannelsChange(channels);
    },
    [onChannelsChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-4 p-3 border rounded-lg bg-muted/30">
      {/* View mode toggle */}
      <div className="flex items-center gap-1 border rounded-md p-0.5">
        {VIEW_MODES.map((mode) => {
          const Icon = mode.icon;
          return (
            <Button
              key={mode.id}
              variant={viewMode === mode.id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onViewModeChange(mode.id)}
              className="h-7 px-2.5 text-xs"
            >
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              {mode.label}
            </Button>
          );
        })}
      </div>

      {/* Variant selector */}
      {availableVariants.length > 1 && (
        <Select value={activeVariantId} onValueChange={onVariantChange}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder="Select variant" />
          </SelectTrigger>
          <SelectContent>
            {availableVariants.map((v) => (
              <SelectItem key={v.id} value={v.id} className="text-xs">
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Channel selector (for overlay and side-by-side modes) */}
      {viewMode !== "summary" &&
        (commonChannels.length > 0 ? (
          <div className="flex-1 min-w-48">
            <ChannelSelector
              channels={commonChannels}
              selectedChannels={selectedChannels}
              onSelectionChange={handleChannelsChange}
              label=""
              variant="compact"
              showSearch
              showSelectAll
              maxHeight="max-h-36"
            />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            No common channels across entries
          </span>
        ))}
    </div>
  );
}
