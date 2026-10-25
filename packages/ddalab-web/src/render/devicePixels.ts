// The size of a plot in device pixels, exactly where the browser reports them: canvases drawn at that size map one
// texel to one device pixel.

export interface PlotSize {
  /** CSS pixels. */
  cssW: number;
  cssH: number;
  dpr: number;
  /** Device pixels. */
  W: number;
  H: number;
}

/** Calls `onResize` with the size of `element` once it is laid out and on every change; returns the disconnect. */
export function observeDevicePixels(element: Element, onResize: (size: PlotSize) => void): () => void {
  const resize = new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    const dpr = window.devicePixelRatio || 1;
    const cssW = entry.contentRect.width;
    const cssH = entry.contentRect.height;
    // The box is exact on real displays; under an emulated pixel ratio Chromium reports CSS pixels in it.
    const exact =
      box && Math.abs(box.inlineSize - cssW * dpr) <= 1 && Math.abs(box.blockSize - cssH * dpr) <= 1;
    onResize({
      cssW,
      cssH,
      dpr,
      W: exact ? box.inlineSize : Math.round(cssW * dpr),
      H: exact ? box.blockSize : Math.round(cssH * dpr),
    });
  });
  try {
    resize.observe(element, { box: "device-pixel-content-box" });
  } catch {
    resize.observe(element); // Safari has no device-pixel box: CSS size times the ratio
  }
  return () => resize.disconnect();
}
