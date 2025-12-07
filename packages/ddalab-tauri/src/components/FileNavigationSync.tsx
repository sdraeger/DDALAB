"use client";

import { useFileNavigation } from "@/hooks/useFileNavigation";

/**
 * Component that synchronizes navigation with the active file.
 * Must be rendered inside ActiveFileProvider.
 * Renders nothing - just runs the synchronization hook.
 */
export function FileNavigationSync() {
  useFileNavigation();
  return null;
}
