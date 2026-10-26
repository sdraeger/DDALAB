// The shortcuts: the tabs' as the strip's tooltip, the switcher and the list of shortcuts give them, Option on a Mac and
// Alt elsewhere; the application menu's (app/AppMenu.tsx), ⌘ on a Mac and Ctrl elsewhere.
const AGENT = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const ALT = AGENT.includes("Mac") ? "Option" : "Alt";
// ⌘ by the platform, which an emulated user agent (the e2e tests') leaves as it is. Ctrl stays free on a Mac, where
// text fields read Ctrl+B and the like as moves of the caret.
const MAC = typeof navigator !== "undefined" && /^Mac/.test(navigator.platform);
const LINUX = AGENT.includes("Linux") && !AGENT.includes("Android");

/** Each shortcut and what it does. */
export const TAB_KEYS: [keys: string, action: string][] = [
  [`${ALT}+1 to ${ALT}+9`, "Jump to a tab; 9 is the last"],
  [`${ALT}+[ and ${ALT}+]`, "Go to the previous and the next tab"],
  [`${ALT}+Shift+[ and ${ALT}+Shift+]`, "Move the tab left or right"],
  [`${ALT}+K`, "Find an open recording, with Close all"],
  ["Delete or Backspace", "Close the focused tab"],
];

/** The shortcuts in one line, for the strip's tooltip and the switcher's foot. */
export const KEYS =
  `${ALT}+1 to ${ALT}+9 jump to a tab, ${ALT}+[ and ${ALT}+] go to the previous and next, ` +
  `${ALT}+Shift+[ and ${ALT}+Shift+] move the tab, Delete or Backspace closes the focused tab.`;

/** What a Linux browser gives up while DDALAB has the focus. */
export const LINUX_NOTE = LINUX ? `On Linux they replace the browser's own ${ALT}+digit tab keys.` : "";

/** A shortcut of the application menu: ⌘ or Ctrl, Shift or not, and the key. */
export interface Shortcut {
  key: string;
  shift?: boolean;
  /** What it does, as the list of shortcuts says. */
  does: string;
}

/** The application menu's shortcuts, by command: none that a browser keeps for itself (⌘W, ⌘Q, ⌘T, ⌘L, ⌘N). */
export const SHORTCUTS = {
  openFiles: { key: "O", does: "Open files" },
  openFolder: { key: "O", shift: true, does: "Open a folder" },
  exportProject: { key: "E", shift: true, does: "Export the open tabs as a project" },
  newWindow: { key: "N", shift: true, does: "Open a new window" },
  library: { key: "B", does: "Show or hide the library" },
  inspector: { key: "\\", does: "Show or hide the inspector" },
  calibration: { key: ",", does: "Display calibration" },
} satisfies Record<string, Shortcut>;

/** A shortcut as the menu and the list print it. */
export const printed = ({ key, shift }: Shortcut) =>
  MAC ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;

/** A shortcut as `aria-keyshortcuts` names it. */
export const ariaKeys = ({ key, shift }: Shortcut) =>
  `${MAC ? "Meta" : "Control"}+${shift ? "Shift+" : ""}${key}`;

/** Whether `event` is `shortcut`. */
export const isShortcut = (event: KeyboardEvent, { key, shift }: Shortcut) =>
  (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
  !event.altKey &&
  event.shiftKey === Boolean(shift) &&
  event.key.toLowerCase() === key.toLowerCase();

/** Each menu shortcut and what it does. */
export const MENU_KEYS: [keys: string, action: string][] = Object.values(SHORTCUTS).map((s: Shortcut) => [
  printed(s),
  s.does,
]);
