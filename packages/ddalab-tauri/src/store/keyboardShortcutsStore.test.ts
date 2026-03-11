import { afterEach, describe, expect, it } from "vitest";
import {
  useKeyboardShortcutsStore,
  type KeyboardShortcut,
} from "./keyboardShortcutsStore";

const resetStore = () => {
  useKeyboardShortcutsStore.setState((state) => ({
    ...state,
    shortcuts: new Map(),
    isHelpOpen: false,
    customBindings: {},
  }));
};

afterEach(() => {
  resetStore();
});

describe("keyboardShortcutsStore", () => {
  it("registers and unregisters shortcuts backed by a Map", () => {
    const shortcut: KeyboardShortcut = {
      id: "test-shortcut",
      key: "k",
      modifiers: ["cmd"],
      label: "Test Shortcut",
      description: "Used to verify Map-backed shortcut registration",
      context: "global",
      action: () => undefined,
    };

    const { registerShortcut, unregisterShortcut } =
      useKeyboardShortcutsStore.getState();

    expect(() => registerShortcut(shortcut)).not.toThrow();
    expect(
      useKeyboardShortcutsStore.getState().shortcuts.get(shortcut.id),
    ).toBeDefined();

    expect(() => unregisterShortcut(shortcut.id)).not.toThrow();
    expect(
      useKeyboardShortcutsStore.getState().shortcuts.has(shortcut.id),
    ).toBe(false);
  });
});
