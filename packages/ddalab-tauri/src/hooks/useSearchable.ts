/**
 * useSearchable - Hook for registering searchable items from components
 *
 * This hook makes it easy to add any component's content to the global search.
 * Items are automatically unregistered when the component unmounts.
 *
 * @example Single item registration
 * ```tsx
 * function MyFeature() {
 *   useSearchable({
 *     id: "feature-export-csv",
 *     type: "action",
 *     title: "Export to CSV",
 *     description: "Export analysis results to CSV file",
 *     category: "Export",
 *     keywords: ["export", "csv", "download", "save"],
 *     icon: "Download",
 *     action: () => handleExportCsv(),
 *   });
 *
 *   return <div>...</div>;
 * }
 * ```
 *
 * @example Multiple items registration
 * ```tsx
 * function JobsList({ jobs }) {
 *   useSearchableItems(
 *     jobs.map(job => ({
 *       id: `job-${job.id}`,
 *       type: "action",
 *       title: job.name,
 *       description: `Status: ${job.status}`,
 *       category: "NSG Jobs",
 *       action: () => selectJob(job.id),
 *     })),
 *     [jobs] // Dependencies - re-register when jobs change
 *   );
 *
 *   return <div>...</div>;
 * }
 * ```
 *
 * @example Dynamic registration with updates
 * ```tsx
 * function DynamicFeature() {
 *   const { update } = useSearchableWithControl({
 *     id: "dynamic-status",
 *     type: "action",
 *     title: "Processing...",
 *     category: "Status",
 *     action: () => {},
 *   });
 *
 *   useEffect(() => {
 *     if (isComplete) {
 *       update({ title: "Complete!", description: "Processing finished" });
 *     }
 *   }, [isComplete, update]);
 *
 *   return <div>...</div>;
 * }
 * ```
 */

import { useEffect, useCallback, useRef, useMemo } from "react";
import { getSearchRegistry, SearchableItem } from "@/services/searchRegistry";

/**
 * Register a single searchable item. Automatically unregisters on unmount.
 */
export function useSearchable(item: SearchableItem): void {
  const registry = getSearchRegistry();

  useEffect(() => {
    const unregister = registry.register(item);
    return unregister;
  }, [
    registry,
    item.id,
    item.type,
    item.title,
    item.subtitle,
    item.description,
    item.category,
    // Note: action and keywords are intentionally excluded from deps
    // to avoid re-registration on every render when using inline functions/arrays
  ]);
}

/**
 * Register multiple searchable items. Automatically unregisters on unmount.
 * Use the dependencies array to control when items are re-registered.
 */
export function useSearchableItems(
  items: SearchableItem[],
  deps: React.DependencyList = [],
): void {
  const registry = getSearchRegistry();

  // Memoize items based on provided dependencies
  const memoizedItems = useMemo(() => items, deps);

  useEffect(() => {
    if (memoizedItems.length === 0) return;

    const unregister = registry.registerMany(memoizedItems);
    return unregister;
  }, [registry, memoizedItems]);
}

/**
 * Register a searchable item with control functions for updates.
 * Returns update and unregister functions for manual control.
 */
export function useSearchableWithControl(item: SearchableItem): {
  update: (updates: Partial<SearchableItem>) => void;
  unregister: () => void;
} {
  const registry = getSearchRegistry();
  const itemIdRef = useRef(item.id);
  const registeredRef = useRef(false);

  // Register on mount
  useEffect(() => {
    registry.register(item);
    registeredRef.current = true;
    itemIdRef.current = item.id;

    return () => {
      registry.unregister(itemIdRef.current);
      registeredRef.current = false;
    };
  }, []); // Only register once on mount

  const update = useCallback(
    (updates: Partial<SearchableItem>) => {
      if (registeredRef.current) {
        registry.update(itemIdRef.current, updates);
      }
    },
    [registry],
  );

  const unregister = useCallback(() => {
    if (registeredRef.current) {
      registry.unregister(itemIdRef.current);
      registeredRef.current = false;
    }
  }, [registry]);

  return { update, unregister };
}

/**
 * Convenience function for creating searchable items with common defaults
 */
export function createSearchableItem(
  base: Pick<SearchableItem, "id" | "title" | "action"> &
    Partial<SearchableItem>,
): SearchableItem {
  return {
    type: "action",
    category: "General",
    priority: 0,
    ...base,
  };
}

/**
 * Create a searchable navigation item
 */
export function createNavigationItem(
  id: string,
  title: string,
  action: () => void,
  options: Partial<SearchableItem> = {},
): SearchableItem {
  return {
    id: `nav-${id}`,
    type: "navigation",
    title,
    category: "Navigation",
    icon: "ArrowRight",
    action,
    ...options,
  };
}

/**
 * Create a searchable action item
 */
export function createActionItem(
  id: string,
  title: string,
  action: () => void,
  options: Partial<SearchableItem> = {},
): SearchableItem {
  return {
    id: `action-${id}`,
    type: "action",
    title,
    category: "Actions",
    icon: "Play",
    action,
    ...options,
  };
}

/**
 * Create a searchable settings item
 */
export function createSettingsItem(
  id: string,
  title: string,
  action: () => void,
  options: Partial<SearchableItem> = {},
): SearchableItem {
  return {
    id: `settings-${id}`,
    type: "settings",
    title,
    category: "Settings",
    icon: "Settings",
    action,
    ...options,
  };
}
