// The color theme: the system's until the user picks one, which localStorage keeps. tokens.css reads `data-theme`
// on <html>; without it, `color-scheme: light dark` follows the system setting.
export type Theme = "light" | "dark";

const KEY = "ddalab.theme";

/** The theme the user picked, or `null` to follow the system. Storage can be missing (some private windows). */
export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** The `chrome` token of each theme (tokens.css), which the window's title bar takes through `theme-color`. */
const CHROME = { light: "#F1F3F5", dark: "#1D2226" };

export function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  // index.html gives each system theme its color; a pick gives both the picked one.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = CHROME[theme ?? (meta.media.includes("dark") ? "dark" : "light")];
  }
}

/** Applies and remembers the user's pick, `null` to follow the system; without storage it lasts for this page. */
export function saveTheme(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {}
  applyTheme(theme);
}
