// The bridge from the CSS colour tokens to canvas drawing, and the signal that the theme changed: the user's pick
// (`data-theme` on <html>) or, while none is set, the system's colour scheme.

/**
 * The colour a CSS value resolves to on `element` (tokens are light-dark() pairs, resolved by the element's colour
 * scheme), as `rgb()` text for 2D canvases and as 0..1 components for WebGL.
 */
export function cssColor(
  element: Element,
  value: string,
): { css: string; rgba: [number, number, number, number] } {
  const probe = document.createElement("span");
  probe.style.color = value;
  probe.style.display = "none";
  element.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const parts = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  // `color(srgb r g b)` gives 0..1 components, `rgb(r, g, b)` 0..255.
  const scale = css.startsWith("color(") ? 1 : 255;
  const [r, g, b] = parts.slice(0, 3).map((p) => p / scale);
  const a = parts.length > 3 ? parts[3] : 1;
  return { css, rgba: [r, g, b, a] };
}

export interface Colors {
  trace: [number, number, number, number];
  ground: string;
  ink: string;
  grid: string;
  hairline: string;
  muted: string;
  event: string;
  eventInk: string;
  primary: string;
  wash: string;
  font: string;
}

export function readColors(element: Element): Colors {
  const color = (value: string) => cssColor(element, value).css;
  return {
    trace: cssColor(element, "var(--trace)").rgba,
    ground: color("var(--ground)"),
    ink: color("var(--ink)"),
    grid: color("var(--grid)"),
    hairline: color("var(--hairline)"),
    muted: color("var(--muted)"),
    event: color("var(--event)"),
    eventInk: color("var(--event-ink)"),
    primary: color("var(--primary)"),
    wash: color("var(--primary-wash)"),
    font: getComputedStyle(element).fontFamily,
  };
}

/** Calls `onChange` when the theme changes; returns the function that stops watching. */
export function watchTheme(onChange: () => void): () => void {
  const picked = new MutationObserver(onChange);
  picked.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", onChange);
  return () => {
    picked.disconnect();
    scheme.removeEventListener("change", onChange);
  };
}
