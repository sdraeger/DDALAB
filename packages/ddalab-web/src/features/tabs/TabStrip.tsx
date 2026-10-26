// The tabs over the central canvas: one per open recording, in the order opened, each keeping its own view
// (store/tabs.ts). A click, Alt+1 to Alt+9, Alt+[ and Alt+], the arrow keys in the strip or the quick switcher (Alt+K)
// change tabs; a drag, Alt+Shift+[ and Alt+Shift+] or the switcher's Move buttons reorder them; the close button, a
// middle click or Delete closes one. A detached tab, whose files the browser cannot read since the last visit, shows a
// note in the canvas with Reattach (app/tabs.ts).
import { Tooltip } from "@base-ui/react/tooltip";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
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
  attachUrl,
  closeAll,
  closeTab,
  detachedTabs,
  pickerFor,
  promptsLeft,
  reattachFrom,
  requestAccess,
  stopCheck,
} from "../../app/tabs";
import { useStore } from "../../store/store";
import { hasHandles, moveTab, selectTab, shortNames, type Tab } from "../../store/tabs";
import controls from "../../styles/controls.module.css";
import styles from "./TabStrip.module.css";

const PANEL = "recording-panel";
const tabId = (fingerprint: string) => `tab-${fingerprint}`;
const AGENT = typeof navigator === "undefined" ? "" : navigator.userAgent;
const ALT = AGENT.includes("Mac") ? "Option" : "Alt";
const KEYS =
  `${ALT}+1 to ${ALT}+9 jump to a tab, ${ALT}+[ and ${ALT}+] go to the previous and next, ` +
  `${ALT}+Shift+[ and ${ALT}+Shift+] move the tab.`;
const LINUX = AGENT.includes("Linux") && !AGENT.includes("Android");
const HINT = `All tabs (${ALT}+K). ${KEYS}${LINUX ? ` On Linux they replace the browser's own ${ALT}+digit tab keys.` : ""}`;
const TEXT_FIELDS =
  'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]';

/** The hidden pickers of Reattach, which an <input> opens only in the task of the click. */
const inputs: Record<"folder" | "files", HTMLInputElement | null> = { folder: null, files: null };
/** The live regions that say where a moved tab is: the strip's, and the switcher's while the rest is inert. */
const announcers = new Set<HTMLElement>();
const announcer = (element: HTMLElement | null) => {
  for (const kept of announcers) if (!kept.isConnected) announcers.delete(kept);
  if (element) announcers.add(element);
};
/** The tab the last Reattach picker was opened for. */
let target: string | null = null;

/** Moves the tab of `fingerprint` one place left (-1) or right (1) and says where it is now. */
function moveBy(fingerprint: string | null, by: -1 | 1) {
  const { tabs } = useStore.getState();
  const from = tabs.findIndex((t) => t.fingerprint === fingerprint);
  const to = from + by;
  if (from < 0 || to < 0 || to >= tabs.length) return;
  // Moving a node takes the focus out of it: it goes back once the order is drawn, to the other Move button of the
  // row when the one pressed is now at an end.
  const focused = document.activeElement as HTMLButtonElement | null;
  moveTab(from, to);
  for (const region of announcers)
    region.textContent = `${tabs[from].name}, position ${to + 1} of ${tabs.length}`;
  requestAnimationFrame(() => {
    if (!focused?.isConnected) return;
    const row = focused.closest("li");
    const other = row?.querySelector<HTMLElement>("[data-move]:not(:disabled)");
    (focused.disabled ? other : focused)?.focus();
  });
}

/**
 * Reattach for `tab`: retries its URL, asks for access to one of its handles, or opens a picker. A click calls it.
 * The attempt, when it starts one.
 */
function reattach(tab: Tab, kind?: "folder" | "files"): Promise<unknown> | undefined {
  if (!kind && tab.source?.kind === "url") return attachUrl(tab);
  if (!kind && hasHandles(tab.source)) return requestAccess(tab);
  const picker = kind ?? pickerFor(tab);
  target = tab.fingerprint;
  // The browser's own pickers (Chromium) give handles, which the next visit reattaches through on its own.
  const native = picker === "folder" ? canPickFolder() && pickFolder : canPickFiles() && pickFiles;
  if (!native) return void inputs[picker]?.click();
  return native().then(
    (chosen) => chosen && reattachFrom(chosen.files, tab.fingerprint, chosen.handles),
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
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
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
  const detached = tabs.filter((t) => !open.includes(t.fingerprint));
  const next = detached.find((t) => t.fingerprint === active) ?? detached[0];
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
    void reattachFrom(files, target);
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
          const state = [!attached && "detached", tab.verifying && "verifying", runs && "running"].filter(
            Boolean,
          );
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
                  {state.length > 0 && <span className={styles.spoken}>, {state.join(", ")}</span>}
                  {tab.verifying && (
                    <span className={styles.verifying} aria-hidden>
                      Verifying
                    </span>
                  )}
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
        {next && (
          <button
            type="button"
            className={controls.quiet}
            aria-label={`Reattach, ${detached.length} detached`}
            onClick={() => {
              selectTab(next.fingerprint);
              void reattach(next);
            }}
          >
            <Link2 aria-hidden />
            Reattach
            <span className={styles.count}>{detached.length}</span>
          </button>
        )}
        <Hint label={HINT}>
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
      <p ref={announcer} className={styles.spoken} aria-live="polite" />
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

/** The canvas of the selected tab: wraps what the shell shows under the strip. */
export function TabPanel({ children }: { children: ReactNode }) {
  const active = useStore((s) => s.activeTab);
  const any = useStore((s) => s.tabs.length > 0);
  // A panel of the tabs while there are any.
  const panel = any ? { role: "tabpanel", "aria-labelledby": active ? tabId(active) : undefined } : {};
  return (
    <div id={PANEL} className={styles.panel} {...panel}>
      {children}
    </div>
  );
}

/**
 * What a detached tab shows: what to do, Reattach, how many others wait, and why it did not reattach when it tried.
 * `brief`: one line over a result shown alone.
 */
export function DetachedNote({ fingerprint, brief }: { fingerprint: string; brief: boolean }) {
  const tab = useStore((s) => s.tabs.find((t) => t.fingerprint === fingerprint));
  const reason = useStore((s) => s.tabReasons[fingerprint]);
  const others = useStore((s) => detachedTabs(s).length) - 1;
  const prompts = usePromptsLeft(tab);
  if (!tab) return null;
  const asks = hasHandles(tab.source);
  const picker = pickerFor(tab);
  // The picker the second button opens: the tab's own when Reattach asks for access, else the other one.
  const other = asks ? picker : picker === "folder" ? "files" : "folder";
  const what = tab.verifying
    ? `Checking that ${tab.name} is the file this tab had open (SHA-256).`
    : tab.source?.kind === "url"
      ? `Reattach to read ${tab.name} from its address again.`
      : asks
        ? `Reattach to let the browser read ${tab.name} again.`
        : picker === "folder"
          ? `Choose the folder that holds ${tab.name} to reattach it, with every detached recording found there.`
          : `Choose ${tab.name} and the files beside it to reattach it.`;
  // What is left to do: the clicks this recording still needs (one per prompt), and the other detached recordings.
  const left = [
    asks &&
      prompts.left > 0 &&
      `${prompts.left} ${prompts.left === 1 ? "click" : "clicks"} left to reattach it`,
    others > 0 && `${others} other ${others === 1 ? "recording is" : "recordings are"} detached`,
  ].filter(Boolean);
  return (
    <div className={brief ? styles.line : styles.note}>
      <p>{what}</p>
      {left.length > 0 && !brief && <p className={styles.more}>{left.join(". ")}</p>}
      {reason && (
        <p role="alert" className={styles.reason}>
          {reason}
        </p>
      )}
      <div className={styles.noteActions}>
        {tab.verifying ? (
          // A check that does not end is never the only way out: Retry stops it and starts over.
          <button
            type="button"
            className={controls.button}
            onClick={() => {
              stopCheck(tab.fingerprint);
              prompts.after(reattach(tab));
            }}
          >
            Retry
          </button>
        ) : (
          <>
            <button type="button" className={controls.primary} onClick={() => prompts.after(reattach(tab))}>
              <Link2 aria-hidden />
              Reattach
            </button>
            {tab.source?.kind === "files" && (
              <button type="button" className={controls.quiet} onClick={() => reattach(tab, other)}>
                {other === "folder" ? "Choose a folder instead" : "Choose files instead"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The prompts `tab` still needs (promptsLeft), counted again after each `after(attempt)`. */
function usePromptsLeft(tab: Tab | undefined) {
  const [left, setLeft] = useState(0);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    if (tab && round >= 0) void promptsLeft(tab).then((n) => live && setLeft(n));
    return () => {
      live = false;
    };
  }, [tab, round]);
  const after = (attempt: Promise<unknown> | undefined) =>
    void attempt?.finally(() => setRound((n) => n + 1));
  return { left, after };
}

/**
 * Alt+1 to Alt+9 (the ninth is the last), Alt+[ and Alt+], Alt+Shift+[ and Alt+Shift+] and Alt+K, anywhere except
 * text fields.
 */
function useTabKeys(onSwitcher: () => void) {
  const open = useEffectEvent(onSwitcher);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest(TEXT_FIELDS)) return;
      const { tabs, activeTab } = useStore.getState();
      const n = tabs.length;
      if (n === 0) return;
      const at = tabs.findIndex((t) => t.fingerprint === activeTab);
      const step = (by: number) => (at < 0 ? (by > 0 ? 0 : n - 1) : (at + by + n) % n);
      // Option on a Mac turns the digit and bracket keys into other characters: the codes stay.
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      const bracket = { BracketLeft: -1, BracketRight: 1 }[event.code] as -1 | 1 | undefined;
      if (event.code === "KeyK") open();
      else if (digit) selectTab(tabs[digit === "9" ? n - 1 : Math.min(n, Number(digit)) - 1].fingerprint);
      else if (bracket && event.shiftKey) moveBy(activeTab, bracket);
      else if (bracket) selectTab(tabs[step(bracket)].fingerprint);
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

/**
 * The quick switcher and the menu of all tabs: every tab, filtered as the user types, each with Move left and Move
 * right. Enter in the field switches to the first match; Down moves into the list; Escape closes.
 */
function Switcher({ onClose }: { onClose(): void }) {
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
