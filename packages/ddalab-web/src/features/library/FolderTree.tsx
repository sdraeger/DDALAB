// The Folder section of the library rail: the walk of an opened folder with its running count, then the folder's
// recordings as a tree. A click or Enter on a recording opens it with its companion files.
import { hotkeysCoreFeature, type ItemInstance, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open.mjs";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { FileHandles, Outcome } from "../../app/recordings";
import {
  classifyFolder,
  type FolderNode,
  type FolderRecording,
  type FolderSource,
  folderTree,
  ROOT,
  type Walked,
  walk,
} from "../../core/folder";
import { useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./FolderTree.module.css";
import rail from "./LibraryRail.module.css";

/** Row heights in px as FolderTree.module.css sets them: the list places rows by them. */
const ROW = { folder: 28, twoLines: 40 };
/** From this many rows on, only the rows in view (and the focused one) are rendered. */
const VIRTUAL_FROM = 200;
/** Rows rendered past each edge of the view. */
const OVERSCAN = 10;
const SEARCH_FROM = 6;
const UNITS = ["kilobyte", "megabyte", "gigabyte", "terabyte"].map(
  (unit) => new Intl.NumberFormat("en-US", { style: "unit", unit, maximumSignificantDigits: 3 }),
);
/** Bytes in decimal units from kB up: 24 kB, 6.71 MB. */
const sizeOf = (bytes: number) => {
  const power = Math.min(UNITS.length, Math.max(1, Math.floor(Math.log10(Math.max(bytes, 1)) / 3)));
  return UNITS[power - 1].format(bytes / 1000 ** power);
};

export default function FolderTree(props: {
  source: FolderSource;
  onOpen(recording: FolderRecording, handles: FileHandles): Promise<Outcome>;
  onClose(): void;
}) {
  const { source, onOpen } = props;
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<{ walked: Walked; recordings: FolderRecording[] }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const walking = new AbortController();
    walk(source, walking.signal, setCount)
      .then(async (walked) => ({ walked, recordings: await classifyFolder(walked.files) }))
      .then(setResult, (failure: Error) => {
        if (!walking.signal.aborted) setError(`The folder could not be read: ${failure.message}`);
      });
    return () => walking.abort();
  }, [source]);
  // A recording opens with the handles of all its files, when the walk has them, and of the opened folder.
  const open = useCallback(
    (recording: FolderRecording) => {
      const { handles, root } = result?.walked ?? {};
      const own = recording.files.map((file) => handles?.get(file));
      const all = own.every((handle): handle is FileSystemFileHandle => handle !== undefined);
      return onOpen(recording, { files: all ? own : undefined, root });
    },
    [result, onOpen],
  );

  return (
    <section className={rail.section} aria-labelledby="folder-heading">
      <h2 id="folder-heading" className={rail.heading}>
        Folder {result && <span className={rail.count}>{result.recordings.length}</span>}
      </h2>
      {error ? (
        <p role="alert" className={rail.error}>
          {error}
        </p>
      ) : result ? (
        <Recordings recordings={result.recordings} unreadable={result.walked.unreadable} onOpen={open} />
      ) : (
        <div className={styles.walking}>
          <p>
            <span role="status">Reading the folder</span>{" "}
            <span className={styles.number}>
              {count.toLocaleString("en-US")} {count === 1 ? "file" : "files"}
            </span>
          </p>
          <button type="button" className={controls.quiet} onClick={props.onClose}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function Recordings(props: {
  recordings: FolderRecording[];
  unreadable: number;
  onOpen(recording: FolderRecording): Promise<Outcome>;
}) {
  const { recordings, unreadable, onOpen } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [filtering, startTransition] = useTransition();
  const whole = useMemo(() => folderTree(recordings, false), [recordings]);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return whole;
    // Paths match below the opened folder, whose name every path shares.
    const below = whole.root ? whole.root.length + 1 : 0;
    const matches = (r: FolderRecording) =>
      r.name.toLowerCase().includes(needle) || r.path.slice(below).toLowerCase().includes(needle);
    return folderTree(recordings.filter(matches), true);
  }, [recordings, whole, filter]);
  const skipped = unreadable > 0 && (
    <p className={rail.hint}>
      {unreadable.toLocaleString("en-US")} {unreadable === 1 ? "file" : "files"} could not be read.
    </p>
  );
  // Which tree row opened which recording; a recording closed since then is no longer marked.
  const [opened, setOpened] = useState<Record<string, string>>({});
  const open = useCallback(
    async (recording: FolderRecording) => {
      const outcome = await onOpen(recording);
      if (outcome.kind === "opened") setOpened((ids) => ({ ...ids, [recording.path]: outcome.id }));
    },
    [onOpen],
  );

  if (recordings.length === 0) {
    return (
      <>
        <p className={rail.hint}>No recording here. DDALAB reads EDF, BDF, BrainVision and delimited text.</p>
        {skipped}
      </>
    );
  }
  return (
    <>
      {whole.root && (
        <p className={styles.root} title={whole.root}>
          <FolderOpen aria-hidden />
          <span>{whole.root}</span>
        </p>
      )}
      {recordings.length >= SEARCH_FROM && (
        <input
          type="search"
          className={styles.filter}
          aria-label="Filter recordings"
          placeholder="Filter by name"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            startTransition(() => setFilter(event.target.value));
          }}
        />
      )}
      {Object.keys(shown.nodes).length > 1 ? (
        // A new filter result opens with its own expansion and focus.
        <Tree
          key={filter}
          nodes={shown.nodes}
          expanded={shown.expanded}
          label={whole.root ? `Recordings in ${whole.root}` : "Recordings"}
          opened={opened}
          stale={filtering}
          onOpen={open}
        />
      ) : (
        <p className={rail.hint}>No recording matches.</p>
      )}
      {skipped}
    </>
  );
}

/** What a folder row's name leaves of its width: padding, chevron, count and gaps, in px; and its indent per level. */
const FOLDER_CHROME = 64;
const INDENT = 12;

function Tree(props: {
  nodes: Record<string, FolderNode>;
  expanded: string[];
  label: string;
  opened: Record<string, string>;
  stale: boolean;
  onOpen(recording: FolderRecording): void;
}) {
  const { nodes, opened, onOpen } = props;
  const recordings = useStore((s) => s.recordings);
  const active = useStore((s) => s.activeRecordingId);
  const describe = useId();
  const tree = useTree<FolderNode>({
    rootItemId: ROOT,
    initialState: { expandedItems: props.expanded },
    // The accessible name starts with the shown label (WCAG 2.5.3); a recording's file name follows.
    getItemName: (item) => {
      const { recording, label } = item.getItemData();
      return recording ? `${label}, ${recording.path.slice(recording.path.lastIndexOf("/") + 1)}` : label;
    },
    isItemFolder: (item) => !item.getItemData().recording,
    dataLoader: { getItem: (id) => nodes[id], getChildren: (id) => nodes[id].children },
    onPrimaryAction: (item) => {
      const { recording } = item.getItemData();
      if (recording && !recording.missing) onOpen(recording);
    },
    hotkeys: {
      customOpen: {
        hotkey: "Enter",
        preventDefault: true,
        handler: (_, tree) => {
          const item = tree.getFocusedItem();
          if (!item.isFolder()) item.primaryAction();
          else if (item.isExpanded()) item.collapse();
          else item.expand();
        },
      },
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });
  const items = tree.getItems();

  // Typeahead: printable keys typed within 600 ms of each other move focus to the next row whose label starts with
  // them. A plain listener sees every key; the tree's hotkeys match only one key held at a time.
  const typed = useRef({ text: "", at: 0 });
  const typeahead = (event: KeyboardEvent) => {
    if (event.key.length !== 1 || event.key === " " || event.ctrlKey || event.metaKey || event.altKey) return;
    const now = event.timeStamp;
    const text = (now - typed.current.at < 600 ? typed.current.text : "") + event.key.toLowerCase();
    typed.current = { text, at: now };
    const from = tree.getFocusedItem().getItemMeta().index + (text.length === 1 ? 1 : 0);
    const match = [...items.slice(from), ...items.slice(0, from)].find((item) =>
      item.getItemData().label.toLowerCase().startsWith(text),
    );
    if (!match) return;
    event.preventDefault();
    match.setFocused();
    tree.updateDomFocus();
  };

  const [view, setView] = useState({ top: 0, height: 0, width: 0, font: "" });
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    // The `font` shorthand reads "" while font-variant-numeric is set (base.css sets tabular-nums): build it.
    const observer = new ResizeObserver(() => {
      const { fontStyle, fontWeight, fontSize, fontFamily } = getComputedStyle(element);
      setView({
        top: element.scrollTop,
        height: element.clientHeight,
        width: element.clientWidth,
        font: `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A chain of folders that does not fit its row takes two lines, as a recording does.
  const wraps = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (context) context.font = view.font;
    return (node: FolderNode, level: number) =>
      !node.recording &&
      node.label.includes(" / ") &&
      (!context || context.measureText(node.label).width > view.width - FOLDER_CHROME - level * INDENT);
  }, [view.width, view.font]);
  const tops: number[] = [];
  const wrapped: boolean[] = [];
  let total = 0;
  for (const item of items) {
    const node = item.getItemData();
    tops.push(total);
    wrapped.push(wraps(node, item.getItemMeta().level));
    total += node.recording || wrapped.at(-1) ? ROW.twoLines : ROW.folder;
  }
  let first = 0;
  let last = items.length;
  if (items.length > VIRTUAL_FROM) {
    const bottom = view.top + (view.height || 600);
    const end = tops.findIndex((top) => top >= bottom);
    first = Math.max(0, tops.findLastIndex((top) => top <= view.top) - OVERSCAN);
    last = end < 0 ? items.length : Math.min(items.length, end + OVERSCAN);
  }
  // The focused row stays rendered, which keeps the tree reachable by Tab and lets focus land on it.
  const focusedIndex = items.findIndex((item) => item.isFocused());
  const rendered = items.slice(first, last);
  if (focusedIndex >= 0 && (focusedIndex < first || focusedIndex >= last)) rendered.push(items[focusedIndex]);

  return (
    <div
      className={styles.scroller}
      ref={measure}
      data-stale={props.stale || undefined}
      onScroll={(event) => setView({ ...view, top: event.currentTarget.scrollTop })}
    >
      <div
        {...tree.getContainerProps(props.label)}
        role="tree"
        className={styles.tree}
        style={{ height: total }}
        // Arrows, Home and End belong to the tree: the viewer leaves keys inside it alone.
        data-own-keys
        onKeyDown={typeahead}
      >
        {rendered.map((item) => (
          <Row
            key={item.getId()}
            item={item}
            top={tops[item.getItemMeta().index]}
            wrap={wrapped[item.getItemMeta().index]}
            tabbable={item.isFocused() || (focusedIndex < 0 && item.getItemMeta().index === 0)}
            describe={`${describe}-${item.getItemMeta().index}`}
            open={item.getId() in opened && opened[item.getId()] in recordings}
            active={active !== null && opened[item.getId()] === active}
          />
        ))}
      </div>
    </div>
  );
}

function Row(props: {
  item: ItemInstance<FolderNode>;
  top: number;
  wrap: boolean;
  tabbable: boolean;
  describe: string;
  open: boolean;
  active: boolean;
}) {
  const { item } = props;
  const { recording, label, count } = item.getItemData();
  const style = {
    "--level": item.getItemMeta().level,
    transform: `translateY(${props.top}px)`,
  } as CSSProperties;
  if (!recording) {
    return (
      <div
        {...item.getProps()}
        tabIndex={props.tabbable ? 0 : -1}
        className={styles.folder}
        data-wrap={props.wrap || undefined}
        style={style}
        title={label}
      >
        <ChevronRight aria-hidden className={styles.chevron} />
        <span className={styles.chain}>
          {label.split(" / ").map((segment, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a chain's folders keep their order
            <span key={i} className={styles.segment}>
              {segment}
            </span>
          ))}
        </span>
        <span className={styles.count}>{count}</span>
      </div>
    );
  }
  const name = recording.path.slice(recording.path.lastIndexOf("/") + 1);
  return (
    <div
      {...item.getProps()}
      role="treeitem"
      tabIndex={props.tabbable ? 0 : -1}
      className={styles.recording}
      style={style}
      title={recording.missing ? `${name}\n${recording.missing}` : name}
      aria-selected={props.active}
      aria-disabled={recording.missing ? true : undefined}
      aria-describedby={props.describe}
    >
      <span className={styles.name}>{label}</span>
      <span className={styles.meta} id={props.describe}>
        {recording.format}
        <span className={rail.thin} aria-hidden />
        {recording.missing ? (
          <span className={styles.missing}>{recording.missing}</span>
        ) : (
          sizeOf(recording.size)
        )}
        {props.open && (
          <>
            <span className={rail.thin} aria-hidden />
            {/* The words tell the shown recording from the other open ones; color only repeats them. */}
            <span className={styles.open}>{props.active ? "Viewing" : "Open"}</span>
          </>
        )}
      </span>
    </div>
  );
}
