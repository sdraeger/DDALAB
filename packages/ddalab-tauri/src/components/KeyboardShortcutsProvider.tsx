"use client";

import { useEffect, useCallback } from "react";
import {
  useKeyboardShortcutsStore,
  DEFAULT_SHORTCUTS,
  type ModifierKey,
  type ShortcutContext,
} from "@/store/keyboardShortcutsStore";
import { useUndoRedoStore } from "@/store/undoRedoStore";
import { useAppStore } from "@/store/appStore";
import { useGlobalSearch } from "@/components/GlobalSearchProvider";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";

interface KeyboardShortcutsProviderProps {
  children: React.ReactNode;
}

export function KeyboardShortcutsProvider({
  children,
}: KeyboardShortcutsProviderProps) {
  const registerShortcut = useKeyboardShortcutsStore((s) => s.registerShortcut);
  const executeShortcut = useKeyboardShortcutsStore((s) => s.executeShortcut);
  const toggleHelp = useKeyboardShortcutsStore((s) => s.toggleHelp);
  const setHelpOpen = useKeyboardShortcutsStore((s) => s.setHelpOpen);

  // App store actions
  const setPrimaryNav = useAppStore((s) => s.setPrimaryNav);
  const setZoom = useAppStore((s) => s.setZoom);
  const ui = useAppStore((s) => s.ui);

  // Undo/Redo
  const undo = useUndoRedoStore((s) => s.undo);
  const redo = useUndoRedoStore((s) => s.redo);

  // Global search
  const { openSearch } = useGlobalSearch();

  // Register all default shortcuts with their actions
  useEffect(() => {
    const shortcuts = DEFAULT_SHORTCUTS.map((shortcut) => {
      let action: () => void | Promise<void>;

      switch (shortcut.id) {
        case "open-search":
          action = openSearch;
          break;
        case "show-shortcuts":
          action = toggleHelp;
          break;
        case "close-dialog":
          action = () => setHelpOpen(false);
          break;
        case "nav-home":
          action = () => setPrimaryNav("overview");
          break;
        case "nav-analysis":
          action = () => setPrimaryNav("analyze");
          break;
        case "nav-streaming":
          action = () => setPrimaryNav("explore");
          break;
        case "nav-settings":
          action = () => setPrimaryNav("manage");
          break;
        case "zoom-in":
          action = () => {
            const newZoom = Math.min((ui.zoom || 1) + 0.1, 1.5);
            setZoom(newZoom);
          };
          break;
        case "zoom-out":
          action = () => {
            const newZoom = Math.max((ui.zoom || 1) - 0.1, 0.75);
            setZoom(newZoom);
          };
          break;
        case "zoom-reset":
          action = () => setZoom(1);
          break;
        case "undo":
          action = () => {
            undo();
          };
          break;
        case "redo":
          action = () => {
            redo();
          };
          break;
        default:
          action = () => {
            console.log(
              `Shortcut ${shortcut.id} triggered but no action defined`,
            );
          };
      }

      return { ...shortcut, action };
    });

    // Register all shortcuts
    shortcuts.forEach((shortcut) => {
      registerShortcut(shortcut);
    });
  }, [
    registerShortcut,
    openSearch,
    toggleHelp,
    setHelpOpen,
    setPrimaryNav,
    setZoom,
    ui.zoom,
    undo,
    redo,
  ]);

  // Global keyboard event handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Allow Escape and some shortcuts even in inputs
      const allowInInput =
        ["Escape", "?"].includes(e.key) || e.metaKey || e.ctrlKey;

      if (isInput && !allowInInput) {
        return;
      }

      // Build modifier array
      const modifiers: ModifierKey[] = [];
      if (e.metaKey) modifiers.push("cmd");
      if (e.ctrlKey && !e.metaKey) modifiers.push("ctrl");
      if (e.shiftKey) modifiers.push("shift");
      if (e.altKey) modifiers.push("alt");

      // Determine current context based on active tab
      let context: ShortcutContext = "global";
      const primaryNav = useAppStore.getState().ui.primaryNav;
      if (primaryNav === "analyze") context = "dda-analysis";
      else if (primaryNav === "explore") context = "streaming";
      else if (primaryNav === "manage") context = "settings";
      else if (primaryNav === "overview") context = "file-manager";

      // Try to execute matching shortcut
      const handled = executeShortcut(e.key, modifiers, context);

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [executeShortcut],
  );

  // Attach global listener
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <>
      {children}
      <KeyboardShortcutsHelp />
    </>
  );
}

// Hook to get shortcut display string for a given action
export function useShortcutDisplay(shortcutId: string): string | null {
  const shortcuts = useKeyboardShortcutsStore((s) => s.shortcuts);
  const formatShortcut = useKeyboardShortcutsStore((s) => s.formatShortcut);

  const shortcut = shortcuts.get(shortcutId);
  if (!shortcut) return null;

  return formatShortcut(shortcut);
}

// Hook to register a custom shortcut from a component
export function useRegisterShortcut() {
  const registerShortcut = useKeyboardShortcutsStore((s) => s.registerShortcut);
  const unregisterShortcut = useKeyboardShortcutsStore(
    (s) => s.unregisterShortcut,
  );

  const register = useCallback(
    (shortcut: Parameters<typeof registerShortcut>[0]) => {
      registerShortcut(shortcut);
      return () => unregisterShortcut(shortcut.id);
    },
    [registerShortcut, unregisterShortcut],
  );

  return register;
}
