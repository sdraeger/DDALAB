import type uPlot from "uplot";

/**
 * Custom crosshair + selection rendering for uPlot that bypasses sub-pixel
 * offset issues caused by macOS non-integer display scaling.
 *
 * Problem: On macOS with "More Space" or non-integer scaling, WKWebView's
 * getBoundingClientRect() returns POSITION values (top/left) in a scaled
 * coordinate space (~10/11 of visual coordinates). BCR.width/height match
 * offsetWidth/offsetHeight, but since ALL absolute positions are scaled,
 * the visual rendered dimensions are also larger than CSS layout dimensions
 * (by the inverse of the position scale factor, ~11/10).
 *
 * Solution: Derive the element's true visual position from mouse events
 * using (e.clientX - e.offsetX, e.clientY - e.offsetY), which uses the
 * actual rendered hit-test position. Detect the position scale factor
 * (visualPos / BCR.pos) once and apply it to dimensions as well. Custom
 * position:fixed overlays on document.body replace uPlot's native cursor
 * elements, and cursor.move corrections fix zoom/hover calculations.
 */

const CROSSHAIR_COLOR = "#607D8B";

interface PlotOverlay {
  vLine: HTMLDivElement;
  hLine: HTMLDivElement;
  selection: HTMLDivElement;
}

interface VisualBounds {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

function createOverlay(): PlotOverlay {
  const vLine = document.createElement("div");
  vLine.style.cssText = `position:fixed;width:0;pointer-events:none;z-index:10000;display:none;border-right:1px dashed ${CROSSHAIR_COLOR};`;
  document.body.appendChild(vLine);

  const hLine = document.createElement("div");
  hLine.style.cssText = `position:fixed;height:0;pointer-events:none;z-index:10000;display:none;border-bottom:1px dashed ${CROSSHAIR_COLOR};`;
  document.body.appendChild(hLine);

  const selection = document.createElement("div");
  selection.style.cssText =
    "position:fixed;pointer-events:none;z-index:9999;display:none;background:rgba(0,0,0,0.07);";
  document.body.appendChild(selection);

  return { vLine, hLine, selection };
}

function showCrosshair(
  ov: PlotOverlay,
  clientX: number,
  clientY: number,
  bounds: VisualBounds,
) {
  ov.vLine.style.display = "block";
  ov.vLine.style.left = `${clientX}px`;
  ov.vLine.style.top = `${bounds.top}px`;
  ov.vLine.style.height = `${bounds.height}px`;

  ov.hLine.style.display = "block";
  ov.hLine.style.left = `${bounds.left}px`;
  ov.hLine.style.top = `${clientY}px`;
  ov.hLine.style.width = `${bounds.width}px`;
}

function hideCrosshair(ov: PlotOverlay) {
  ov.vLine.style.display = "none";
  ov.hLine.style.display = "none";
}

function showSelection(
  ov: PlotOverlay,
  startX: number,
  currentX: number,
  bounds: VisualBounds,
) {
  const left = Math.max(Math.min(startX, currentX), bounds.left);
  const right = Math.min(Math.max(startX, currentX), bounds.right);

  if (right - left < 1) {
    ov.selection.style.display = "none";
    return;
  }

  ov.selection.style.display = "block";
  ov.selection.style.left = `${left}px`;
  ov.selection.style.top = `${bounds.top}px`;
  ov.selection.style.width = `${right - left}px`;
  ov.selection.style.height = `${bounds.height}px`;
}

function hideSelection(ov: PlotOverlay) {
  ov.selection.style.display = "none";
}

/** Minimum drag distance (in px) before showing selection overlay. */
const DRAG_THRESHOLD = 10;

/** Minimum BCR position to compute a reliable scale ratio. */
const MIN_POS_FOR_SCALE = 50;

/**
 * Module-level display scale factor, detected once and shared across all
 * uPlot instances. On macOS with non-integer scaling this is ~11/10 (1.1).
 * On normal displays it stays at 1.0.
 */
let _displayScale = 1;

/**
 * Convert a mouse clientX/clientY coordinate to a CSS pixel offset within
 * an element, correcting for macOS display scaling where BCR positions
 * don't match visual/mouse event coordinates.
 *
 * Use this anywhere you'd normally write `e.clientX - rect.left`.
 */
export function clientToCSS(clientPos: number, bcrPos: number): number {
  return clientPos / _displayScale - bcrPos;
}

export function zoomCursorMove(): uPlot.Cursor.MousePosRefiner {
  let overlay: PlotOverlay | null = null;
  let attached = false;

  // Visual position derived from mouse events each frame.
  let visualLeft = 0;
  let visualTop = 0;
  let hasVisualPos = false;

  // Position scale: ratio of visual position to BCR position.
  // On macOS with non-integer scaling this is ~11/10 (1.1).
  // On normal displays it stays at 1.0.
  let scaleX = 1;
  let scaleY = 1;
  let scaleDetected = false;

  return (self, mouseLeft, mouseTop) => {
    const over = self.root.querySelector(".u-over") as HTMLElement | null;
    if (!over) return [mouseLeft, mouseTop];

    if (!attached) {
      attached = true;
      overlay = createOverlay();
      const ov = overlay;

      let dragStartX: number | null = null;
      let dragging = false;

      over.addEventListener("mousemove", (e: MouseEvent) => {
        // Derive visual position from mouse event coordinates.
        // e.offsetX/Y is relative to the element's rendered (hit-test) position,
        // so (e.clientX - e.offsetX) gives the true visual left edge.
        visualLeft = e.clientX - e.offsetX;
        visualTop = e.clientY - e.offsetY;
        hasVisualPos = true;

        // Detect position scale factor once from the first reliable measurement.
        if (!scaleDetected) {
          const bcr = over.getBoundingClientRect();
          const canX = bcr.left > MIN_POS_FOR_SCALE;
          const canY = bcr.top > MIN_POS_FOR_SCALE;
          if (canX) scaleX = visualLeft / bcr.left;
          if (canY) scaleY = visualTop / bcr.top;
          // If only one axis detected, use it for both (scaling is uniform)
          if (!canX && canY) scaleX = scaleY;
          if (canX && !canY) scaleY = scaleX;
          if (canX || canY) {
            scaleDetected = true;
            _displayScale = scaleX;
          }
        }

        // Compute visual bounds: position from mouse events, dimensions
        // scaled by the same factor that affects positions.
        const w = over.offsetWidth * scaleX;
        const h = over.offsetHeight * scaleY;
        const bounds: VisualBounds = {
          top: visualTop,
          left: visualLeft,
          width: w,
          height: h,
          right: visualLeft + w,
          bottom: visualTop + h,
        };

        showCrosshair(ov, e.clientX, e.clientY, bounds);

        if (dragStartX !== null) {
          if (!dragging && Math.abs(e.clientX - dragStartX) >= DRAG_THRESHOLD) {
            dragging = true;
          }
          if (dragging) {
            showSelection(ov, dragStartX, e.clientX, bounds);
          }
        }
      });

      over.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button === 0) {
          dragStartX = e.clientX;
          dragging = false;
        }
      });

      window.addEventListener("mouseup", () => {
        if (dragStartX !== null) {
          dragStartX = null;
          dragging = false;
          hideSelection(ov);
        }
      });

      over.addEventListener("mouseleave", () => {
        hideCrosshair(ov);
      });
    }

    // Correct mouseLeft/mouseTop for uPlot's internal zoom/hover.
    // uPlot computes mouseLeft = e.clientX - BCR.left (mixed coordinate spaces).
    // We need correctedMouseLeft in CSS pixels [0, plotWidCss]:
    //   corrected = (mouseLeft + BCR.left - visualLeft) / scaleX
    // This maps from the visual coordinate space back to CSS layout space.
    if (hasVisualPos) {
      const bcr = over.getBoundingClientRect();
      return [
        (mouseLeft + bcr.left - visualLeft) / scaleX,
        (mouseTop + bcr.top - visualTop) / scaleY,
      ];
    }

    return [mouseLeft, mouseTop];
  };
}
