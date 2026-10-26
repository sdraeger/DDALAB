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

export function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** Applies and remembers the user's pick; without storage it lasts for this page. */
export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  applyTheme(theme);
}
