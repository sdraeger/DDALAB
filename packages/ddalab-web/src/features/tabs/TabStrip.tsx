// The tabs over the central canvas: one per open recording, in the order opened, each keeping its own view
// (store/tabs.ts). A click, Alt+1 to Alt+9, Alt+[ and Alt+], the arrow keys in the strip or the quick switcher (Alt+K)
// change tabs; a drag reorders them; the close button, a middle click or Delete closes one. A detached tab, whose
// files the browser cannot read since the last visit, shows a note in the canvas with Reattach (app/tabs.ts).
import { Tooltip } from "@base-ui/react/tooltip";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Link2 from "lucide-react/dist/esm/icons/link-2.mjs";
import Link2Off from "lucide-react/dist/esm/icons/link-2-off.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { canPickFolder, pickFolder } from "../../app/handles";
import { canPickFiles, pickFiles } from "../../app/recordings";
import {
  closeAll,
  closeTab,
  pickerFor,
  reattachAsks,
  reattachFrom,
  reattachWithAccess,
} from "../../app/tabs";
import { useStore } from "../../store/store";
import { moveTab, selectTab, shortNames, useTabs } from "../../store/tabs";
import controls from "../../styles/controls.module.css";
import styles from "./TabStrip.module.css";

const PANEL = "recording-panel";
const tabId = (fingerprint: string) => `tab-${fingerprint}`;
const ALT = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac") ? "Option" : "Alt";
const KEYS = `${ALT}+1 to ${ALT}+9 jump to a tab, ${ALT}+[ and ${ALT}+] go to the previous and next.`;
const TEXT_FIELDS =
  'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]';

/** The hidden pickers of Reattach, which an <input> opens only in the task of the click. */
const inputs: Record<"folder" | "files", HTMLInputElement | null> = { folder: null, files: null };

/** Reattach: asks for access when every detached tab has handles, else opens `kind` of picker. A click calls it. */
function reattach(kind?: "folder" | "files") {
  if (!kind && reattachAsks()) return void reattachWithAccess();
  const picker = kind ?? pickerFor();
  // The browser's own pickers (Chromium) give handles, which the next visit reattaches through on its own.
  const native = picker === "folder" ? canPickFolder() && pickFolder : canPickFiles() && pickFiles;
  if (!native) return inputs[picker]?.click();
  void native().then(
    (chosen) => chosen && reattachFrom(chosen.files, chosen.handles),
    () => {}, // the user closed the picker
  );
}

/** Which tabs are attached and which one runs, by fingerprint. */
function useAttached() {
  const open = useStore(useShallow((s) => Object.values(s.recordings).map((r) => r.fingerprint)));
  const running = useStore((s) =>
    s.run?.status === "running" ? s.recordings[s.run.recordingId]?.fingerprint : undefined,
  );
  return { open, running };
}

export function TabStrip() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const { open, running } = useAttached();
  const [switching, setSwitching] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useTabKeys(() => setSwitching(true));
  const dragging = useReorder(list);

  useEffect(() => {
    if (!active) return;
    list.current
      ?.querySelector(`[aria-selected="true"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  if (tabs.length === 0) return null;
  const labels = shortNames(tabs.map((t) => t.name));
  const detached = tabs.some((t) => !open.includes(t.fingerprint));
  const focusSelected = () =>
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[aria-selected="true"]`)?.focus());

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const n = buttons.length;
    const to = { ArrowLeft: (at - 1 + n) % n, ArrowRight: (at + 1) % n, Home: 0, End: n - 1 }[event.key];
    if (to !== undefined) buttons[to].focus();
    else if (event.key === "Delete") {
      closeTab(tabs[at].fingerprint);
      focusSelected();
    } else return;
    event.preventDefault();
  };
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void reattachFrom(files);
  };

  return (
    <div className={styles.strip}>
      <div
        ref={list}
        role="tablist"
        aria-label="Open recordings"
        className={styles.tabs}
        data-dragging={dragging || undefined}
        // The keys it handles do not page the recording (useViewerKeys skips a handled key); the others still do.
        onKeyDown={onKey}
        onWheel={(event) => {
          if (list.current && event.deltaX === 0) list.current.scrollLeft += event.deltaY;
        }}
      >
        {tabs.map((tab, i) => {
          const fingerprint = tab.fingerprint;
          const selected = fingerprint === active;
          const attached = open.includes(fingerprint);
          const runs = running === fingerprint;
          const state = [!attached && "detached", runs && "running"].filter(Boolean).join(", ");
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: the pointer drags and middle-clicks the whole tab; the keyboard uses the tab button inside
            <div
              key={fingerprint}
              role="presentation"
              className={styles.tab}
              data-selected={selected || undefined}
              data-detached={!attached || undefined}
              onPointerDown={(event) => startDrag(event, i)}
              // A middle click closes; without this it would start the browser's autoscroll.
              onMouseDown={(event) => event.button === 1 && event.preventDefault()}
              onAuxClick={(event) => event.button === 1 && closeTab(fingerprint)}
            >
              <button
                type="button"
                role="tab"
                id={tabId(fingerprint)}
                aria-selected={selected}
                aria-controls={PANEL}
                aria-keyshortcuts="Delete"
                tabIndex={selected || (active === null && i === 0) ? 0 : -1}
                className={styles.select}
                title={tab.name}
                onClick={() => selectTab(fingerprint)}
              >
                <span className={styles.row}>
                  {!attached && <Link2Off aria-hidden />}
                  <span className={styles.label}>{labels[i]}</span>
                  {state && <span className={styles.spoken}>, {state}</span>}
                  {runs && <span className={styles.running} title="Run in progress" />}
                </span>
              </button>
              {/* The mouse's way to close; the keyboard's is Delete on the tab. */}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                className={styles.close}
                title={`Close ${tab.name}`}
                data-close
                onClick={() => closeTab(fingerprint)}
              >
                <X />
              </button>
            </div>
          );
        })}
      </div>
      <div className={styles.end}>
        {detached && (
          <button type="button" className={controls.quiet} onClick={() => reattach()}>
            <Link2 aria-hidden />
            Reattach
          </button>
        )}
        <Hint label={`All tabs (${ALT}+K). ${KEYS}`}>
          <button
            type="button"
            aria-label="All tabs"
            aria-keyshortcuts="Alt+K"
            className={controls.iconButton}
            onClick={() => setSwitching(true)}
          >
            <ChevronDown aria-hidden />
          </button>
        </Hint>
      </div>
      <input
        ref={(element) => {
          inputs.files = element;
        }}
        type="file"
        multiple
        hidden
        aria-label="Reattach files"
        onChange={picked}
      />
      <input
        ref={(element) => {
          inputs.folder = element;
        }}
        type="file"
        hidden
        aria-label="Reattach folder"
        onChange={picked}
        {...{ webkitdirectory: "" }}
      />
      {switching && <Switcher onClose={() => setSwitching(false)} />}
    </div>
  );
}

/** A tooltip on `children`, the one element it describes. */
function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children as ReactElement} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6} align="end">
          <Tooltip.Popup className={controls.tooltip}>{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** The canvas of the active tab: wraps what the shell shows under the strip. */
export function TabPanel({ children }: { children: ReactNode }) {
  const active = useTabs((s) => s.active);
  const any = useTabs((s) => s.tabs.length > 0);
  // A panel of the tabs while there are any.
  const panel = any ? { role: "tabpanel", "aria-labelledby": active ? tabId(active) : undefined } : {};
  return (
    <div id={PANEL} className={styles.panel} {...panel}>
      {children}
    </div>
  );
}

/** What a detached tab shows: what to do, Reattach, and why it did not reattach when it tried. */
export function DetachedNote({ fingerprint }: { fingerprint: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.fingerprint === fingerprint));
  const reason = useTabs((s) => s.reasons[fingerprint]);
  if (!tab) return null;
  const asks = reattachAsks();
  const picker = pickerFor();
  const what =
    tab.source?.kind === "url"
      ? `Reattach to read ${tab.name} from its address again.`
      : asks
        ? `Reattach to let the browser read ${tab.name} again. It asks once for each folder.`
        : picker === "folder"
          ? `Choose the folder that holds ${tab.name}: it reattaches with every detached recording found there.`
          : `Choose ${tab.name} and the files beside it to reattach it.`;
  return (
    <div className={styles.note}>
      <p>{what}</p>
      {reason && (
        <p role="alert" className={styles.reason}>
          {reason}
        </p>
      )}
      <div className={styles.noteActions}>
        <button type="button" className={controls.primary} onClick={() => reattach()}>
          <Link2 aria-hidden />
          Reattach
        </button>
        {!asks && tab.source?.kind === "files" && (
          <button
            type="button"
            className={controls.quiet}
            onClick={() => reattach(picker === "folder" ? "files" : "folder")}
          >
            {picker === "folder" ? "Choose files instead" : "Choose a folder instead"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Alt+1 to Alt+9 (the ninth is the last), Alt+[ and Alt+] and Alt+K, anywhere except text fields. */
function useTabKeys(onSwitcher: () => void) {
  const open = useEffectEvent(onSwitcher);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest(TEXT_FIELDS)) return;
      const { tabs, active } = useTabs.getState();
      const n = tabs.length;
      if (n === 0) return;
      const at = tabs.findIndex((t) => t.fingerprint === active);
      const step = (by: number) => (at < 0 ? (by > 0 ? 0 : n - 1) : (at + by + n) % n);
      // Codes, not keys: Option on a Mac turns the digit and bracket keys into other characters.
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (event.code === "KeyK") open();
      else if (digit) selectTab(tabs[digit === "9" ? n - 1 : Math.min(n, Number(digit)) - 1].fingerprint);
      else if (event.code === "BracketLeft") selectTab(tabs[step(-1)].fingerprint);
      else if (event.code === "BracketRight") selectTab(tabs[step(1)].fingerprint);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** The drag in progress: the tab moved, where it started, the tabs' boxes then and the place it would drop at. */
let drag: { from: number; x0: number; el: HTMLElement; boxes: DOMRect[]; to: number; moved: boolean } | null =
  null;

function startDrag(event: PointerEvent<HTMLDivElement>, from: number) {
  if (event.button !== 0 || (event.target as Element).closest("[data-close]")) return;
  const items = Array.from(event.currentTarget.parentElement?.children ?? []) as HTMLElement[];
  const boxes = items.map((item) => item.getBoundingClientRect());
  drag = { from, x0: event.clientX, el: event.currentTarget, boxes, to: from, moved: false };
}

/**
 * Reordering by drag: the dragged tab follows the pointer and the tabs it passes make room, both with transforms;
 * the order changes on release. Whether a drag is under way.
 */
function useReorder(list: RefObject<HTMLDivElement | null>) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const items = () => Array.from(list.current?.children ?? []) as HTMLElement[];
    const move = (event: globalThis.PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.el.dataset.dragging = "";
        setDragging(true);
      }
      const { from, boxes } = drag;
      const width = boxes[from].width;
      const center = boxes[from].left + width / 2 + dx;
      drag.to = boxes.filter((box, k) => k !== from && box.left + box.width / 2 < center).length;
      const to = drag.to;
      drag.el.style.transform = `translateX(${dx}px)`;
      items().forEach((item, k) => {
        const shift = k > from && k <= to ? -width : k < from && k >= to ? width : 0;
        if (k !== from) item.style.transform = shift ? `translateX(${shift}px)` : "";
      });
    };
    const end = () => {
      const done = drag;
      drag = null;
      if (!done?.moved) return;
      for (const item of items()) item.style.transform = "";
      delete done.el.dataset.dragging;
      setDragging(false);
      if (done.to !== done.from) moveTab(done.from, done.to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [list]);
  return dragging;
}

/** The quick switcher: every tab, filtered as the user types; Enter switches, Escape closes. */
function Switcher({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const { open, running } = useAttached();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      tabs.findIndex((t) => t.fingerprint === active),
    ),
  );
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const needle = query.trim().toLowerCase();
  const shown = tabs.filter((t) => t.name.toLowerCase().includes(needle));
  const highlighted = Math.min(at, shown.length - 1);
  const choose = (fingerprint?: string) => {
    dialog.current?.close();
    if (fingerprint) selectTab(fingerprint);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const n = shown.length;
    if (event.key === "ArrowDown" && n > 0) setAt((highlighted + 1) % n);
    else if (event.key === "ArrowUp" && n > 0) setAt((highlighted - 1 + n) % n);
    else if (event.key === "Enter") choose(shown[highlighted]?.fingerprint);
    else return;
    event.preventDefault();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop lands on the dialog itself; Escape is the keyboard's way out
    <dialog
      ref={dialog}
      className={styles.switcher}
      aria-label="Switch recording"
      data-own-keys
      onClose={onClose}
      onClick={(event) => event.target === dialog.current && choose()}
    >
      <input
        className={styles.find}
        role="combobox"
        aria-label="Find an open recording"
        aria-expanded
        aria-controls="tab-options"
        aria-activedescendant={shown[highlighted] ? `option-${shown[highlighted].fingerprint}` : undefined}
        aria-autocomplete="list"
        placeholder="Switch to a recording"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setAt(0);
        }}
        onKeyDown={onKey}
      />
      <div id="tab-options" role="listbox" aria-label="Open recordings" className={styles.options}>
        {shown.map((tab, i) => {
          const state = !open.includes(tab.fingerprint)
            ? "Detached"
            : running === tab.fingerprint
              ? "Running"
              : "";
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox above takes the keys of the list
            <div
              key={tab.fingerprint}
              id={`option-${tab.fingerprint}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === highlighted}
              className={styles.option}
              onPointerMove={() => i !== highlighted && setAt(i)}
              onClick={() => choose(tab.fingerprint)}
            >
              <span className={styles.optionName}>{tab.name}</span>
              {state && <span className={styles.optionState}>{state}</span>}
            </div>
          );
        })}
      </div>
      {shown.length === 0 && <p className={styles.none}>No open recording matches.</p>}
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
