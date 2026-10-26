// Clinical paging and scaling from the keyboard, anywhere except text fields, open menus and lists that scroll with
// their own keys.
import { useEffect } from "react";
import {
  pageBy,
  pageToEnd,
  pageToStart,
  setSelection,
  setView,
  stepSensitivity,
  useStore,
  zoomBy,
} from "../../store/store";

export const OWN_KEYS =
  'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"], ' +
  '[role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="dialog"], [data-own-keys]';

export function useViewerKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest(OWN_KEYS)) return;
      const { activeRecordingId, view, cursorS, selection } = useStore.getState();
      if (!activeRecordingId) return;
      // Zoom keeps the cursor in place, or the middle of the view when the cursor is off screen.
      const at =
        cursorS !== null && cursorS >= view.t0 && cursorS <= view.t1 ? cursorS : (view.t0 + view.t1) / 2;
      switch (event.key) {
        case "PageDown":
        case "ArrowRight":
          pageBy(1);
          break;
        case "PageUp":
        case "ArrowLeft":
          pageBy(-1);
          break;
        case "Home":
          pageToStart();
          break;
        case "End":
          pageToEnd();
          break;
        case "+":
        case "=":
          zoomBy(0.5, at);
          break;
        case "-":
          zoomBy(2, at);
          break;
        case "]":
          stepSensitivity(1);
          break;
        case "[":
          stepSensitivity(-1);
          break;
        case "ArrowDown":
          setView((v) => ({ firstChannel: v.firstChannel + 1 }));
          break;
        case "ArrowUp":
          setView((v) => ({ firstChannel: v.firstChannel - 1 }));
          break;
        case "Escape":
          if (!selection) return;
          setSelection(null);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
