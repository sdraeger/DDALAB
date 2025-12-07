"use client";

import { useFileTabShortcuts } from "@/hooks/useFileTabShortcuts";

/**
 * Component that registers file tab keyboard shortcuts.
 * Renders nothing - just runs the shortcuts hook.
 */
export function FileTabShortcuts() {
  useFileTabShortcuts();
  return null;
}
