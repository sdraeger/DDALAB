// The quick switcher and the menu of all tabs (Alt+K, or All tabs on the strip): every tab, filtered as the user
// types, each with Move left and Move right, and Close all. Enter in the field switches to the first match; Down moves
// into the list; Escape closes. Loaded the first time it opens.
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { closeAll } from "../../app/tabs";
import { useStore } from "../../store/store";
import { selectTab } from "../../store/tabs";
import controls from "../../styles/controls.module.css";
import { KEYS } from "./keys";
import { announcer, moveBy, useAttached } from "./TabStrip";
import styles from "./TabStrip.module.css";

export default function Switcher({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = useRef<HTMLUListElement>(null);
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const { open, running } = useAttached();
  const [query, setQuery] = useState("");
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const needle = query.trim().toLowerCase();
  const shown = tabs.filter((t) => t.name.toLowerCase().includes(needle));
  const choose = (fingerprint?: string) => {
    dialog.current?.close();
    if (fingerprint) selectTab(fingerprint);
  };
  /** Moves the focus `by` rows from the row holding the focus; from the field, Down goes to the first row. */
  const focusRow = (by: number) => {
    const buttons = Array.from(rows.current?.querySelectorAll<HTMLElement>("[data-choose]") ?? []);
    const at = buttons.findIndex((button) => button.closest("li")?.contains(document.activeElement));
    if (at < 0 && by > 0) return buttons[0]?.focus();
    if (at + by < 0) return dialog.current?.querySelector<HTMLElement>("input")?.focus();
    buttons[Math.min(buttons.length - 1, at + by)]?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown") focusRow(1);
    else if (event.key === "ArrowUp") focusRow(-1);
    else if (event.key === "Enter" && event.target instanceof HTMLInputElement) choose(shown[0]?.fingerprint);
    else return;
    event.preventDefault();
  };
  return (
    <dialog
      ref={dialog}
      className={styles.switcher}
      data-appear
      aria-label="Switch recording"
      data-own-keys
      onClose={onClose}
      onKeyDown={onKey}
      onClick={(event) => event.target === dialog.current && choose()}
    >
      <input
        type="search"
        className={styles.find}
        aria-label="Find an open recording"
        placeholder="Switch to a recording"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul ref={rows} aria-label="Matching recordings" className={styles.options}>
        {shown.map((tab) => {
          const i = tabs.indexOf(tab);
          const state = !open.includes(tab.fingerprint)
            ? "Detached"
            : running === tab.fingerprint
              ? "Running"
              : "";
          return (
            <li key={tab.fingerprint} className={styles.option}>
              <button
                type="button"
                className={styles.choose}
                aria-current={tab.fingerprint === active || undefined}
                data-choose
                onClick={() => choose(tab.fingerprint)}
              >
                <span className={styles.optionName}>{tab.name}</span>
                {state && <span className={styles.optionState}>{state}</span>}
              </button>
              <button
                type="button"
                className={controls.iconButton}
                aria-label={`Move ${tab.name} left`}
                data-move
                disabled={i === 0}
                onClick={() => moveBy(tab.fingerprint, -1)}
              >
                <ChevronLeft aria-hidden />
              </button>
              <button
                type="button"
                className={controls.iconButton}
                aria-label={`Move ${tab.name} right`}
                data-move
                disabled={i === tabs.length - 1}
                onClick={() => moveBy(tab.fingerprint, 1)}
              >
                <ChevronRight aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className={styles.none}>No open recording matches.</p>}
      <p ref={announcer} className={styles.spoken} aria-live="polite" />
      <div className={styles.foot}>
        <span>{KEYS}</span>
        <button
          type="button"
          className={controls.quiet}
          onClick={() => {
            choose();
            closeAll();
          }}
        >
          Close all
        </button>
      </div>
    </dialog>
  );
}
