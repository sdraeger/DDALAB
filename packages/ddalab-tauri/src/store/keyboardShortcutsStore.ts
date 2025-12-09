import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";

export type ShortcutContext =
  | "global"
  | "file-manager"
  | "dda-analysis"
  | "streaming"
  | "annotations"
  | "settings"
  | "plots";

export type ModifierKey = "cmd" | "ctrl" | "shift" | "alt" | "meta";

export interface KeyboardShortcut {
  id: string;
  key: string; // The main key (e.g., "k", "s", "enter")
  modifiers: ModifierKey[]; // Required modifiers
  label: string; // Human-readable label
  description: string;
  context: ShortcutContext;
  action: () => void | Promise<void>;
  enabled?: boolean;
  // For display
  category?: string;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: KeyboardShortcut[];
}

interface KeyboardShortcutsState {
  // Registry of all shortcuts
  shortcuts: Map<string, KeyboardShortcut>;

  // Help overlay visibility
  isHelpOpen: boolean;

  // Custom key bindings (user overrides)
  customBindings: Record<string, { key: string; modifiers: ModifierKey[] }>;

  // Actions
  registerShortcut: (shortcut: KeyboardShortcut) => void;
  unregisterShortcut: (id: string) => void;
  executeShortcut: (
    key: string,
    modifiers: ModifierKey[],
    context?: ShortcutContext,
  ) => boolean;
  setHelpOpen: (open: boolean) => void;
  toggleHelp: () => void;
  getShortcutsByContext: (context: ShortcutContext) => KeyboardShortcut[];
  getGroupedShortcuts: () => ShortcutGroup[];
  formatShortcut: (shortcut: KeyboardShortcut) => string;
  updateCustomBinding: (
    id: string,
    binding: { key: string; modifiers: ModifierKey[] },
  ) => void;
  resetBinding: (id: string) => void;
}

const normalizeModifiers = (modifiers: ModifierKey[]): string[] => {
  return [...modifiers].sort();
};

const modifiersMatch = (
  required: ModifierKey[],
  pressed: ModifierKey[],
): boolean => {
  const normalizedRequired = normalizeModifiers(required);
  const normalizedPressed = normalizeModifiers(pressed);
  return (
    normalizedRequired.length === normalizedPressed.length &&
    normalizedRequired.every((m, i) => m === normalizedPressed[i])
  );
};

const formatShortcutDisplay = (
  key: string,
  modifiers: ModifierKey[],
): string => {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");

  const modifierSymbols: Record<ModifierKey, string> = {
    cmd: isMac ? "⌘" : "Ctrl",
    ctrl: isMac ? "⌃" : "Ctrl",
    shift: isMac ? "⇧" : "Shift",
    alt: isMac ? "⌥" : "Alt",
    meta: isMac ? "⌘" : "Win",
  };

  const parts = modifiers.map((m) => modifierSymbols[m]);
  parts.push(key.toUpperCase());

  return parts.join(isMac ? "" : "+");
};

export const useKeyboardShortcutsStore = create<KeyboardShortcutsState>()(
  persist(
    immer((set, get) => ({
      shortcuts: new Map(),
      isHelpOpen: false,
      customBindings: {},

      registerShortcut: (shortcut) => {
        set((state) => {
          state.shortcuts.set(shortcut.id, {
            ...shortcut,
            enabled: shortcut.enabled ?? true,
          });
        });
      },

      unregisterShortcut: (id) => {
        set((state) => {
          state.shortcuts.delete(id);
        });
      },

      executeShortcut: (key, modifiers, context) => {
        const { shortcuts, customBindings } = get();

        for (const [id, shortcut] of shortcuts) {
          if (shortcut.enabled === false) continue;

          // Check context
          if (
            context &&
            shortcut.context !== "global" &&
            shortcut.context !== context
          ) {
            continue;
          }

          // Get effective binding (custom or default)
          const binding = customBindings[id] || {
            key: shortcut.key,
            modifiers: shortcut.modifiers,
          };

          // Check if this shortcut matches
          if (
            binding.key.toLowerCase() === key.toLowerCase() &&
            modifiersMatch(binding.modifiers, modifiers)
          ) {
            try {
              shortcut.action();
              return true;
            } catch {
              // Shortcut action failed silently
            }
          }
        }

        return false;
      },

      setHelpOpen: (open) => {
        set((state) => {
          state.isHelpOpen = open;
        });
      },

      toggleHelp: () => {
        set((state) => {
          state.isHelpOpen = !state.isHelpOpen;
        });
      },

      getShortcutsByContext: (context) => {
        const { shortcuts } = get();
        return Array.from(shortcuts.values()).filter(
          (s) => s.context === context || s.context === "global",
        );
      },

      getGroupedShortcuts: () => {
        const { shortcuts, customBindings } = get();
        const groups: Record<string, KeyboardShortcut[]> = {};

        for (const shortcut of shortcuts.values()) {
          const category = shortcut.category || shortcut.context;
          if (!groups[category]) {
            groups[category] = [];
          }
          groups[category].push(shortcut);
        }

        return Object.entries(groups).map(([name, shortcuts]) => ({
          name,
          shortcuts: shortcuts.sort((a, b) => a.label.localeCompare(b.label)),
        }));
      },

      formatShortcut: (shortcut) => {
        const { customBindings } = get();
        const binding = customBindings[shortcut.id] || {
          key: shortcut.key,
          modifiers: shortcut.modifiers,
        };
        return formatShortcutDisplay(binding.key, binding.modifiers);
      },

      updateCustomBinding: (id, binding) => {
        set((state) => {
          state.customBindings[id] = binding;
        });
      },

      resetBinding: (id) => {
        set((state) => {
          delete state.customBindings[id];
        });
      },
    })),
    {
      name: "ddalab-keyboard-shortcuts",
      partialize: (state) => ({
        customBindings: state.customBindings,
      }),
      // Need to handle Map serialization
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          return JSON.parse(str);
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);

// Default shortcuts to register
export const DEFAULT_SHORTCUTS: Omit<KeyboardShortcut, "action">[] = [
  // Global
  {
    id: "open-search",
    key: "k",
    modifiers: ["cmd"],
    label: "Open Search",
    description: "Open the command palette",
    context: "global",
    category: "Navigation",
  },
  {
    id: "show-shortcuts",
    key: "?",
    modifiers: ["shift"],
    label: "Show Shortcuts",
    description: "Show keyboard shortcuts help",
    context: "global",
    category: "Help",
  },
  {
    id: "close-dialog",
    key: "Escape",
    modifiers: [],
    label: "Close",
    description: "Close current dialog or panel",
    context: "global",
    category: "Navigation",
  },

  // File Manager
  {
    id: "open-file",
    key: "o",
    modifiers: ["cmd"],
    label: "Open File",
    description: "Open file browser",
    context: "file-manager",
    category: "Files",
  },
  {
    id: "refresh-files",
    key: "r",
    modifiers: ["cmd"],
    label: "Refresh",
    description: "Refresh file list",
    context: "file-manager",
    category: "Files",
  },

  // DDA Analysis
  {
    id: "run-analysis",
    key: "Enter",
    modifiers: ["cmd"],
    label: "Run Analysis",
    description: "Start DDA analysis",
    context: "dda-analysis",
    category: "Analysis",
  },
  {
    id: "cancel-analysis",
    key: ".",
    modifiers: ["cmd"],
    label: "Cancel Analysis",
    description: "Cancel running analysis",
    context: "dda-analysis",
    category: "Analysis",
  },
  {
    id: "export-results",
    key: "e",
    modifiers: ["cmd"],
    label: "Export Results",
    description: "Export analysis results",
    context: "dda-analysis",
    category: "Analysis",
  },

  // Navigation tabs (number keys)
  {
    id: "nav-home",
    key: "1",
    modifiers: ["cmd"],
    label: "Go to Home",
    description: "Navigate to Home tab",
    context: "global",
    category: "Navigation",
  },
  {
    id: "nav-analysis",
    key: "2",
    modifiers: ["cmd"],
    label: "Go to Analysis",
    description: "Navigate to Analysis tab",
    context: "global",
    category: "Navigation",
  },
  {
    id: "nav-streaming",
    key: "3",
    modifiers: ["cmd"],
    label: "Go to Streaming",
    description: "Navigate to Streaming tab",
    context: "global",
    category: "Navigation",
  },
  {
    id: "nav-settings",
    key: "4",
    modifiers: ["cmd"],
    label: "Go to Settings",
    description: "Navigate to Settings tab",
    context: "global",
    category: "Navigation",
  },

  // Zoom
  {
    id: "zoom-in",
    key: "=",
    modifiers: ["cmd"],
    label: "Zoom In",
    description: "Increase zoom level",
    context: "global",
    category: "View",
  },
  {
    id: "zoom-out",
    key: "-",
    modifiers: ["cmd"],
    label: "Zoom Out",
    description: "Decrease zoom level",
    context: "global",
    category: "View",
  },
  {
    id: "zoom-reset",
    key: "0",
    modifiers: ["cmd"],
    label: "Reset Zoom",
    description: "Reset zoom to 100%",
    context: "global",
    category: "View",
  },

  // Undo/Redo
  {
    id: "undo",
    key: "z",
    modifiers: ["cmd"],
    label: "Undo",
    description: "Undo last action",
    context: "global",
    category: "Edit",
  },
  {
    id: "redo",
    key: "z",
    modifiers: ["cmd", "shift"],
    label: "Redo",
    description: "Redo last undone action",
    context: "global",
    category: "Edit",
  },
];
