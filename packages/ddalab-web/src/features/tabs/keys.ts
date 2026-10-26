// The tab shortcuts as the strip's tooltip, the switcher and About list them. Option on a Mac, Alt elsewhere.
const AGENT = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const ALT = AGENT.includes("Mac") ? "Option" : "Alt";
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
