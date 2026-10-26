// The command bar's Annotate and the annotation keys. A annotates as the button does; Cmd or Ctrl+Z undoes the last
// annotation change on the active recording and Shift+Cmd or Ctrl+Z redoes it, except in a text field, which keeps
// its own undo.
import { Tooltip } from "@base-ui/react/tooltip";
import FlagIcon from "lucide-react/dist/esm/icons/flag.mjs";
import { useEffect } from "react";
import { activeRecording, useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import { OWN_KEYS } from "../viewer/useViewerKeys";
import styles from "./Annotate.module.css";
import { annotate, redo, undo } from "./model";

const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]';

export function useAnnotationKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const fingerprint = activeRecording(useStore.getState())?.fingerprint;
      const target = event.target instanceof Element ? event.target : null;
      const key = event.key.toLowerCase();
      if (!fingerprint) return;
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        if (target?.closest(TEXT_FIELD)) return;
        if (event.shiftKey) redo(fingerprint);
        else undo(fingerprint);
      } else if (key === "a" && !event.metaKey && !event.ctrlKey && !target?.closest(OWN_KEYS)) {
        annotate();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function AnnotateButton() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        className={`${controls.button} ${styles.button}`}
        aria-label="Annotate"
        aria-keyshortcuts="A"
        onClick={() => annotate()}
      >
        <FlagIcon aria-hidden />
        <span className={styles.label}>Annotate</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className={controls.tooltip}>
            Mark the selection, or the time under the pointer (A)
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
