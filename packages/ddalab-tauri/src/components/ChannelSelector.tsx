import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  memo,
} from "react";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent } from "./ui/card";
import { Search, X, CheckSquare, Square, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScrollTrap } from "@/hooks/useScrollTrap";

// Configuration constants
const VIRTUALIZATION_THRESHOLD = 50;
const ROW_HEIGHT = 36;
const MIN_ITEM_WIDTH = 100;
const GRID_GAP = 8;

// Hook for measuring container width with ResizeObserver
function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(ref.current);
    // Initial measurement
    setWidth(ref.current.offsetWidth);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

// Calculate optimal column count based on container width
function calculateColumns(containerWidth: number): number {
  if (containerWidth <= 0) return 4;
  const effectiveWidth = containerWidth - 16; // Account for padding
  const columns = Math.floor(
    (effectiveWidth + GRID_GAP) / (MIN_ITEM_WIDTH + GRID_GAP),
  );
  return Math.max(1, Math.min(columns, 8)); // Clamp between 1-8 columns
}

// Memoized channel item component
interface ChannelItemProps {
  channel: string;
  isSelected: boolean;
  isFocused: boolean;
  disabled: boolean;
  onClick: () => void;
  onFocus: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

const ChannelItem = memo(function ChannelItem({
  channel,
  isSelected,
  isFocused,
  disabled,
  onClick,
  onFocus,
  buttonRef,
}: ChannelItemProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onClick={onClick}
      onFocus={onFocus}
      disabled={disabled}
      className={cn(
        "flex items-center justify-between w-full h-8 px-3 rounded-md text-sm font-medium transition-all",
        "border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        isSelected
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-input hover:bg-accent hover:text-accent-foreground",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:brightness-95",
      )}
    >
      <span className="truncate flex-1 text-left">{channel}</span>
      {isSelected && <Check className="h-3.5 w-3.5 ml-2 flex-shrink-0" />}
    </button>
  );
});

// Virtualized row renderer
interface VirtualizedRowData {
  channels: string[];
  selectedChannels: Set<string>;
  focusedIndex: number;
  disabled: boolean;
  onToggle: (channel: string) => void;
  setFocusedIndex: (index: number) => void;
  columnsPerRow: number;
}

const VirtualizedRow = memo(function VirtualizedRow({
  index,
  style,
  data,
}: ListChildComponentProps<VirtualizedRowData>) {
  const {
    channels,
    selectedChannels,
    focusedIndex,
    disabled,
    onToggle,
    setFocusedIndex,
    columnsPerRow,
  } = data;

  const startIdx = index * columnsPerRow;
  const rowChannels = channels.slice(startIdx, startIdx + columnsPerRow);

  return (
    <div
      style={{
        ...style,
        display: "grid",
        gridTemplateColumns: `repeat(${columnsPerRow}, 1fr)`,
        gap: GRID_GAP,
        paddingLeft: GRID_GAP,
        paddingRight: GRID_GAP,
      }}
    >
      {rowChannels.map((channel, i) => {
        const globalIndex = startIdx + i;
        return (
          <ChannelItem
            key={channel}
            channel={channel}
            isSelected={selectedChannels.has(channel)}
            isFocused={focusedIndex === globalIndex}
            disabled={disabled}
            onClick={() => {
              setFocusedIndex(globalIndex);
              onToggle(channel);
            }}
            onFocus={() => setFocusedIndex(globalIndex)}
          />
        );
      })}
      {/* Fill empty cells to maintain grid alignment */}
      {rowChannels.length < columnsPerRow &&
        Array.from({ length: columnsPerRow - rowChannels.length }).map(
          (_, i) => <div key={`empty-${i}`} />,
        )}
    </div>
  );
});

// Non-virtualized grid component
interface ChannelGridProps {
  channels: string[];
  selectedChannels: Set<string>;
  focusedIndex: number;
  disabled: boolean;
  maxHeight: string;
  onToggle: (channel: string) => void;
  setFocusedIndex: (index: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  label: string;
  columnsPerRow: number;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  setBadgeRef: (index: number) => (el: HTMLButtonElement | null) => void;
}

const ChannelGrid = memo(function ChannelGrid({
  channels,
  selectedChannels,
  focusedIndex,
  disabled,
  maxHeight,
  onToggle,
  setFocusedIndex,
  onKeyDown,
  label,
  columnsPerRow,
  listContainerRef,
  setBadgeRef,
}: ChannelGridProps) {
  const { containerProps, isScrollEnabled } = useScrollTrap({
    activationDelay: 100,
  });

  return (
    <div
      ref={(node) => {
        // Combine refs
        if (listContainerRef) {
          (
            listContainerRef as React.MutableRefObject<HTMLDivElement | null>
          ).current = node;
        }
        containerProps.ref(node);
      }}
      role="listbox"
      aria-label={label}
      aria-multiselectable="true"
      tabIndex={channels.length > 0 && !disabled ? 0 : -1}
      onKeyDown={onKeyDown}
      onMouseEnter={containerProps.onMouseEnter}
      onMouseLeave={containerProps.onMouseLeave}
      onFocus={(e) => {
        if (e.target === listContainerRef.current && focusedIndex === -1) {
          setFocusedIndex(0);
        }
      }}
      className={cn(
        "grid gap-2 p-2 border rounded-md bg-muted/30",
        maxHeight,
        isScrollEnabled ? "overflow-y-auto" : "overflow-hidden",
        disabled && "opacity-50",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
      style={{
        ...containerProps.style,
        gridTemplateColumns: `repeat(${columnsPerRow}, 1fr)`,
      }}
    >
      {channels.map((channel, index) => (
        <ChannelItem
          key={channel}
          channel={channel}
          isSelected={selectedChannels.has(channel)}
          isFocused={focusedIndex === index}
          disabled={disabled}
          onClick={() => {
            setFocusedIndex(index);
            onToggle(channel);
          }}
          onFocus={() => setFocusedIndex(index)}
          buttonRef={setBadgeRef(index)}
        />
      ))}
    </div>
  );
});

// Virtualized list wrapper
interface VirtualizedChannelListProps {
  channels: string[];
  selectedChannels: Set<string>;
  focusedIndex: number;
  disabled: boolean;
  onToggle: (channel: string) => void;
  setFocusedIndex: (index: number) => void;
  label: string;
  columnsPerRow: number;
  height?: number;
}

const VirtualizedChannelList = memo(function VirtualizedChannelList({
  channels,
  selectedChannels,
  focusedIndex,
  disabled,
  onToggle,
  setFocusedIndex,
  label,
  columnsPerRow,
  height = 280,
}: VirtualizedChannelListProps) {
  const rowCount = Math.ceil(channels.length / columnsPerRow);

  const itemData: VirtualizedRowData = useMemo(
    () => ({
      channels,
      selectedChannels,
      focusedIndex,
      disabled,
      onToggle,
      setFocusedIndex,
      columnsPerRow,
    }),
    [
      channels,
      selectedChannels,
      focusedIndex,
      disabled,
      onToggle,
      setFocusedIndex,
      columnsPerRow,
    ],
  );

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-multiselectable="true"
      className={cn(
        "border rounded-md bg-muted/30 overflow-hidden",
        disabled && "opacity-50",
      )}
    >
      <FixedSizeList
        height={height}
        width="100%"
        itemCount={rowCount}
        itemSize={ROW_HEIGHT + GRID_GAP}
        overscanCount={3}
        itemData={itemData}
        className="scrollbar-thin"
        style={{ paddingTop: GRID_GAP / 2, paddingBottom: GRID_GAP / 2 }}
      >
        {VirtualizedRow}
      </FixedSizeList>
      <div className="text-xs text-muted-foreground text-center py-1.5 border-t bg-muted/50">
        {channels.length} channels ({rowCount} rows × {columnsPerRow} columns)
      </div>
    </div>
  );
});

// Search bar component
interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  disabled: boolean;
  placeholder: string;
  compact?: boolean;
}

const SearchBar = memo(function SearchBar({
  value,
  onChange,
  onClear,
  disabled,
  placeholder,
  compact = false,
}: SearchBarProps) {
  return (
    <div className="relative">
      <Search
        className={cn(
          "absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          compact ? "left-2 h-4 w-4" : "left-3 h-4 w-4",
        )}
      />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(compact ? "pl-8 pr-8 h-9" : "pl-9 pr-9")}
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "absolute top-1/2 -translate-y-1/2",
            compact ? "right-1 h-7 w-7 p-0" : "right-1 h-8 w-8 p-0",
          )}
          onClick={onClear}
          aria-label="Clear search"
        >
          <X className={cn(compact ? "h-3 w-3" : "h-4 w-4")} aria-hidden />
        </Button>
      )}
    </div>
  );
});

// Selection controls component
interface SelectionControlsProps {
  selectedCount: number;
  totalCount: number;
  filteredCount: number;
  showFiltered: boolean;
  allFilteredSelected: boolean;
  someFilteredSelected: boolean;
  disabled: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  compact?: boolean;
}

const SelectionControls = memo(function SelectionControls({
  selectedCount,
  totalCount,
  filteredCount,
  showFiltered,
  allFilteredSelected,
  someFilteredSelected,
  disabled,
  onSelectAll,
  onDeselectAll,
  compact = false,
}: SelectionControlsProps) {
  if (compact) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {selectedCount} of {totalCount} selected
          {showFiltered && ` (${filteredCount} shown)`}
        </span>
        {filteredCount > 0 && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelectAll}
              disabled={disabled || allFilteredSelected}
              className="h-7 px-2 text-xs"
            >
              <CheckSquare className="h-3 w-3 mr-1" />
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeselectAll}
              disabled={disabled || !someFilteredSelected}
              className="h-7 px-2 text-xs"
            >
              <Square className="h-3 w-3 mr-1" />
              None
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onSelectAll}
        disabled={disabled || allFilteredSelected}
        className="h-8"
      >
        <CheckSquare className="h-4 w-4 mr-1.5" />
        Select All
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onDeselectAll}
        disabled={disabled || !someFilteredSelected}
        className="h-8"
      >
        <Square className="h-4 w-4 mr-1.5" />
        Deselect All
      </Button>
    </div>
  );
});

// Empty state component
interface EmptyStateProps {
  searchQuery: string;
}

const EmptyState = memo(function EmptyState({ searchQuery }: EmptyStateProps) {
  return (
    <div className="w-full text-center text-sm text-muted-foreground py-8 border rounded-md bg-muted/30">
      {searchQuery ? (
        <>
          No channels match <span className="font-medium">"{searchQuery}"</span>
        </>
      ) : (
        "No channels available"
      )}
    </div>
  );
});

// Main component props
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

export const ChannelSelector = memo(function ChannelSelector({
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
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const badgeRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Measure container width for responsive columns
  const containerWidth = useContainerWidth(containerRef);
  const columnsPerRow = calculateColumns(containerWidth);

  // Convert selected channels to Set for O(1) lookup
  const selectedSet = useMemo(
    () => new Set(selectedChannels),
    [selectedChannels],
  );

  // Filter channels based on search
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const query = searchQuery.toLowerCase();
    return channels.filter((ch) => ch.toLowerCase().includes(query));
  }, [channels, searchQuery]);

  // Reset focus when channels change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [filteredChannels.length]);

  // Focus management
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < filteredChannels.length) {
      badgeRefs.current.get(focusedIndex)?.focus();
    }
  }, [focusedIndex, filteredChannels.length]);

  // Selection state
  const allFilteredSelected =
    filteredChannels.length > 0 &&
    filteredChannels.every((ch) => selectedSet.has(ch));
  const someFilteredSelected = filteredChannels.some((ch) =>
    selectedSet.has(ch),
  );

  // Handlers
  const handleToggle = useCallback(
    (channel: string) => {
      if (disabled) return;
      const newSelection = selectedSet.has(channel)
        ? selectedChannels.filter((ch) => ch !== channel)
        : [...selectedChannels, channel];
      onSelectionChange(newSelection);
    },
    [disabled, selectedSet, selectedChannels, onSelectionChange],
  );

  const handleSelectAll = useCallback(() => {
    if (disabled) return;
    const newSelection = Array.from(
      new Set([...selectedChannels, ...filteredChannels]),
    );
    onSelectionChange(newSelection);
  }, [disabled, selectedChannels, filteredChannels, onSelectionChange]);

  const handleDeselectAll = useCallback(() => {
    if (disabled) return;
    const filteredSet = new Set(filteredChannels);
    const remaining = selectedChannels.filter((ch) => !filteredSet.has(ch));
    onSelectionChange(remaining);
  }, [disabled, selectedChannels, filteredChannels, onSelectionChange]);

  const handleClearSearch = useCallback(() => setSearchQuery(""), []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled || filteredChannels.length === 0) return;

      const { key } = event;
      let newIndex = focusedIndex;

      switch (key) {
        case "ArrowRight":
          event.preventDefault();
          newIndex =
            focusedIndex < filteredChannels.length - 1 ? focusedIndex + 1 : 0;
          break;
        case "ArrowLeft":
          event.preventDefault();
          newIndex =
            focusedIndex > 0 ? focusedIndex - 1 : filteredChannels.length - 1;
          break;
        case "ArrowDown":
          event.preventDefault();
          newIndex = Math.min(
            focusedIndex + columnsPerRow,
            filteredChannels.length - 1,
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          newIndex = Math.max(focusedIndex - columnsPerRow, 0);
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
    [
      disabled,
      filteredChannels,
      focusedIndex,
      columnsPerRow,
      handleToggle,
      handleSelectAll,
    ],
  );

  const setBadgeRef = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      if (el) badgeRefs.current.set(index, el);
      else badgeRefs.current.delete(index);
    },
    [],
  );

  // Determine if virtualization is needed
  const useVirtualization = filteredChannels.length >= VIRTUALIZATION_THRESHOLD;

  // Compact variant
  if (variant === "compact") {
    return (
      <div ref={containerRef} className="space-y-2">
        {showSearch && (
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={handleClearSearch}
            disabled={disabled}
            placeholder={placeholder}
            compact
          />
        )}

        {showSelectAll && (
          <SelectionControls
            selectedCount={selectedChannels.length}
            totalCount={channels.length}
            filteredCount={filteredChannels.length}
            showFiltered={!!searchQuery}
            allFilteredSelected={allFilteredSelected}
            someFilteredSelected={someFilteredSelected}
            disabled={disabled}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            compact
          />
        )}

        {filteredChannels.length === 0 ? (
          <EmptyState searchQuery={searchQuery} />
        ) : useVirtualization ? (
          <VirtualizedChannelList
            channels={filteredChannels}
            selectedChannels={selectedSet}
            focusedIndex={focusedIndex}
            disabled={disabled}
            onToggle={handleToggle}
            setFocusedIndex={setFocusedIndex}
            label={label}
            columnsPerRow={columnsPerRow}
            height={256}
          />
        ) : (
          <ChannelGrid
            channels={filteredChannels}
            selectedChannels={selectedSet}
            focusedIndex={focusedIndex}
            disabled={disabled}
            maxHeight={maxHeight}
            onToggle={handleToggle}
            setFocusedIndex={setFocusedIndex}
            onKeyDown={handleKeyDown}
            label={label}
            columnsPerRow={columnsPerRow}
            listContainerRef={listContainerRef}
            setBadgeRef={setBadgeRef}
          />
        )}
      </div>
    );
  }

  // Default variant
  return (
    <Card>
      <CardContent ref={containerRef} className="pt-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <Label className="text-base font-medium">
              {label}
              <span className="text-muted-foreground font-normal ml-2">
                ({selectedChannels.length} of {channels.length})
              </span>
            </Label>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
          {showSelectAll && (
            <SelectionControls
              selectedCount={selectedChannels.length}
              totalCount={channels.length}
              filteredCount={filteredChannels.length}
              showFiltered={!!searchQuery}
              allFilteredSelected={allFilteredSelected}
              someFilteredSelected={someFilteredSelected}
              disabled={disabled}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
            />
          )}
        </div>

        {showSearch && (
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={handleClearSearch}
            disabled={disabled}
            placeholder={placeholder}
          />
        )}

        {searchQuery && (
          <div className="text-sm text-muted-foreground">
            Showing {filteredChannels.length} of {channels.length} channels
          </div>
        )}

        {filteredChannels.length === 0 ? (
          <EmptyState searchQuery={searchQuery} />
        ) : useVirtualization ? (
          <VirtualizedChannelList
            channels={filteredChannels}
            selectedChannels={selectedSet}
            focusedIndex={focusedIndex}
            disabled={disabled}
            onToggle={handleToggle}
            setFocusedIndex={setFocusedIndex}
            label={label}
            columnsPerRow={columnsPerRow}
          />
        ) : (
          <ChannelGrid
            channels={filteredChannels}
            selectedChannels={selectedSet}
            focusedIndex={focusedIndex}
            disabled={disabled}
            maxHeight={maxHeight}
            onToggle={handleToggle}
            setFocusedIndex={setFocusedIndex}
            onKeyDown={handleKeyDown}
            label={label}
            columnsPerRow={columnsPerRow}
            listContainerRef={listContainerRef}
            setBadgeRef={setBadgeRef}
          />
        )}
      </CardContent>
    </Card>
  );
});

export default ChannelSelector;
