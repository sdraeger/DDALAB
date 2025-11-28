"use client";

import React, { useRef, useCallback } from "react";
import {
  FixedSizeList,
  VariableSizeList,
  ListChildComponentProps,
} from "react-window";
import { cn } from "@/lib/utils";

export interface VirtualizedListProps<T> {
  /** The items to render */
  items: T[];
  /** Height of each item in pixels (for fixed size list) */
  itemHeight: number;
  /** Height of the list container */
  height: number;
  /** Width of the list container (default: 100%) */
  width?: number | string;
  /** Render function for each item */
  renderItem: (
    item: T,
    index: number,
    style: React.CSSProperties,
  ) => React.ReactNode;
  /** Key extractor for each item */
  getItemKey?: (item: T, index: number) => string | number;
  /** Optional className for the list container */
  className?: string;
  /** Number of items to overscan (render outside visible area) */
  overscanCount?: number;
  /** Optional empty state */
  emptyState?: React.ReactNode;
}

/**
 * Virtualized list component using react-window.
 * Only renders visible items for better performance with large lists.
 */
export function VirtualizedList<T>({
  items,
  itemHeight,
  height,
  width = "100%",
  renderItem,
  getItemKey,
  className,
  overscanCount = 5,
  emptyState,
}: VirtualizedListProps<T>) {
  const listRef = useRef<FixedSizeList>(null);

  // Row renderer for react-window
  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = items[index];
      return renderItem(item, index, style);
    },
    [items, renderItem],
  );

  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <FixedSizeList
      ref={listRef}
      height={height}
      width={width}
      itemCount={items.length}
      itemSize={itemHeight}
      overscanCount={overscanCount}
      className={cn("scrollbar-thin", className)}
      itemKey={
        getItemKey
          ? (index: number) => getItemKey(items[index], index)
          : undefined
      }
    >
      {Row}
    </FixedSizeList>
  );
}

export interface VariableVirtualizedListProps<T> {
  /** The items to render */
  items: T[];
  /** Function to get height of each item */
  getItemHeight: (index: number) => number;
  /** Height of the list container */
  height: number;
  /** Width of the list container (default: 100%) */
  width?: number | string;
  /** Render function for each item */
  renderItem: (
    item: T,
    index: number,
    style: React.CSSProperties,
  ) => React.ReactNode;
  /** Key extractor for each item */
  getItemKey?: (item: T, index: number) => string | number;
  /** Optional className for the list container */
  className?: string;
  /** Number of items to overscan (render outside visible area) */
  overscanCount?: number;
  /** Optional empty state */
  emptyState?: React.ReactNode;
}

/**
 * Variable height virtualized list component.
 * Use when items have different heights.
 */
export function VariableVirtualizedList<T>({
  items,
  getItemHeight,
  height,
  width = "100%",
  renderItem,
  getItemKey,
  className,
  overscanCount = 5,
  emptyState,
}: VariableVirtualizedListProps<T>) {
  const listRef = useRef<VariableSizeList>(null);

  // Row renderer for react-window
  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = items[index];
      return renderItem(item, index, style);
    },
    [items, renderItem],
  );

  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <VariableSizeList
      ref={listRef}
      height={height}
      width={width}
      itemCount={items.length}
      itemSize={getItemHeight}
      overscanCount={overscanCount}
      className={cn("scrollbar-thin", className)}
      itemKey={
        getItemKey
          ? (index: number) => getItemKey(items[index], index)
          : undefined
      }
    >
      {Row}
    </VariableSizeList>
  );
}

/**
 * Hook to calculate dynamic height for virtualized lists
 * based on container size.
 */
export function useListHeight(
  containerRef: React.RefObject<HTMLElement>,
  fallbackHeight: number = 400,
): number {
  const [height, setHeight] = React.useState(fallbackHeight);

  React.useEffect(() => {
    if (!containerRef.current) return;

    const updateHeight = () => {
      if (containerRef.current) {
        setHeight(containerRef.current.clientHeight);
      }
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  return height;
}
