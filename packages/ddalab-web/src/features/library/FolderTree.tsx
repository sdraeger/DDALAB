// The Folder section of the library rail: the walk of an opened folder with its running count, then the folder's
// recordings as a tree. A click or Enter on a recording opens it with its companion files. "Run on all" runs the DDA
// settings on every recording shown (Batch.tsx); a folder opened to resume a batch resumes it once it is read.
import {
  createTree,
  hotkeysCoreFeature,
  type ItemInstance,
  syncDataLoaderFeature,
  type TreeConfig,
  type TreeState,
} from "@headless-tree/core";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open.mjs";
import Play from "lucide-react/dist/esm/icons/play.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { resumeBatch } from "../../app/batch";
import type { FileHandles, Outcome } from "../../app/recordings";
import { discovered, type Mark } from "../../core/batch";
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
import { pathOf } from "../../core/sources";
import { useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import { useHit } from "../../styles/hit";
import { BatchAction, BatchProgressView } from "./Batch";
import styles from "./FolderTree.module.css";
import rail from "./LibraryRail.module.css";

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
  /** The batch to resume on the recordings of this folder. */
  resume?: string;
}) {
  const { source, onOpen, resume } = props;
  const [count, setCount] = useState(0);
  // `bids`: the opened folder is a BIDS dataset's root, which a batch reads as `ddalab batch --bids-dir` does.
  const [result, setResult] = useState<{ walked: Walked; recordings: FolderRecording[]; bids: boolean }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const walking = new AbortController();
    walk(source, walking.signal, setCount)
      .then(async (walked) => ({
        walked,
        recordings: await classifyFolder(walked.files),
        bids: walked.files.some((file) => /^[^/]+\/dataset_description\.json$/.test(pathOf(file))),
      }))
      .then(
        (found) => {
          setResult(found);
          if (resume && !walking.signal.aborted)
            void resumeBatch(resume, found.recordings, found.walked.root);
        },
        (failure: Error) => {
          if (!walking.signal.aborted) setError(`The folder could not be read: ${failure.message}`);
        },
      );
    return () => walking.abort();
  }, [source, resume]);
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
    <section className={rail.section} aria-labelledby="folder-heading" data-appear>
      <h2 id="folder-heading" className={rail.heading}>
        Folder {result && <span className={rail.count}>{result.recordings.length}</span>}
      </h2>
      {error ? (
        <p role="alert" className={rail.error}>
          {error}
        </p>
      ) : result ? (
        <Recordings
          recordings={result.recordings}
          unreadable={result.walked.unreadable}
          handle={result.walked.root}
          bids={result.bids}
          onOpen={open}
        />
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

const counted = (n: number, what: string) => `${n.toLocaleString("en-US")} ${what}${n === 1 ? "" : "s"}`;

function Recordings(props: {
  recordings: FolderRecording[];
  unreadable: Walked["unreadable"];
  handle?: FileSystemDirectoryHandle;
  bids: boolean;
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
  // The batch's recordings, of the ones shown: in a BIDS dataset the CLI's, a header without its data file
  // included (it fails as in the CLI); elsewhere the ones that open, in path order.
  const runnable = useMemo(() => {
    const listed = recordings.filter((r) => shown.nodes[r.path] !== undefined);
    return props.bids && whole.root ? discovered(listed, whole.root) : listed.filter((r) => !r.missing);
  }, [recordings, shown, props.bids, whole.root]);
  const lost = [
    unreadable.files > 0 && counted(unreadable.files, "file"),
    unreadable.folders > 0 && counted(unreadable.folders, "folder"),
  ].filter(Boolean);
  const skipped = lost.length > 0 && (
    <p role="status" className={rail.hint}>
      {lost.join(" and ")} could not be read.
    </p>
  );
  // Which tree row opened which recording; a recording closed since then is no longer marked.
  const [opened, setOpened] = useState<Record<string, string>>({});
  // An open in progress, or why the last one failed, shown beside the tree.
  const [opening, setOpening] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const open = useCallback(
    async (recording: FolderRecording) => {
      setFailure(undefined);
      setOpening(recording.name);
      const outcome = await onOpen(recording);
      setOpening(undefined);
      if (outcome.kind === "error") setFailure(outcome.message);
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
      <div className={styles.head}>
        {whole.root && (
          <p className={styles.root} title={whole.root}>
            <FolderOpen aria-hidden />
            <span>{whole.root}</span>
          </p>
        )}
        <BatchAction recordings={runnable} root={whole.root} handle={props.handle} />
      </div>
      <BatchProgressView root={whole.root} />
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
          root={whole.root}
          opened={opened}
          stale={filtering}
          onOpen={open}
        />
      ) : (
        <p className={rail.hint}>No recording matches.</p>
      )}
      {opening && (
        <p className={rail.hint} aria-live="polite">
          Opening {opening}
        </p>
      )}
      {failure && (
        <p role="alert" className={rail.error}>
          {failure}
        </p>
      )}
      {skipped}
    </>
  );
}

/**
 * useTree of @headless-tree/react with one build of the rows, before the paint. That hook builds them in an effect,
 * which can run after a paint: a new filter result (a new Tree) would show no rows for that frame. And a build of
 * its own there, after this one, would hold the page once more for a pass over every row.
 */
function useTreeBuiltOnce<T>(config: TreeConfig<T>) {
  const [tree] = useState(() => createTree(config));
  const [state, setState] = useState(() => tree.getState());
  useLayoutEffect(() => {
    tree.setMounted(true);
    tree.rebuildTree();
    return () => tree.setMounted(false);
  }, [tree]);
  // The core hands setState whole states.
  tree.setConfig((prev) => ({
    ...prev,
    ...config,
    state: { ...state, ...config.state },
    setState: (next) => setState(next as TreeState<T>),
  }));
  return tree;
}

/** What a folder row's name leaves of its width: padding, chevron, count and gaps, in px; and its indent per level. */
const FOLDER_CHROME = 64;
const INDENT = 12;

function Tree(props: {
  nodes: Record<string, FolderNode>;
  expanded: string[];
  label: string;
  root: string;
  opened: Record<string, string>;
  stale: boolean;
  onOpen(recording: FolderRecording): void;
}) {
  const { nodes, opened, onOpen } = props;
  // Row heights in px as FolderTree.module.css sets them (--hit, --hit-two): the list places rows by them.
  const row = useHit();
  const recordings = useStore((s) => s.recordings);
  const active = useStore((s) => s.activeRecordingId);
  // The marks of this folder's batch.
  const marks = useStore((s) => (s.batch?.root === props.root ? s.batch.marks : undefined));
  const describe = useId();
  const tree = useTreeBuiltOnce<FolderNode>({
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
  // The rows' places, once per build and width: an item method allocates on every call, so a render calls them only
  // for the rows it draws.
  const places = useMemo(() => {
    const tops: number[] = [];
    const wrapped: boolean[] = [];
    const index = new Map<string, number>();
    let total = 0;
    for (const item of items) {
      const meta = item.getItemMeta();
      const node = nodes[meta.itemId];
      index.set(meta.itemId, meta.index);
      tops.push(total);
      wrapped.push(wraps(node, meta.level));
      total += node.recording || wrapped.at(-1) ? row.two : row.one;
    }
    return { tops, wrapped, total, index };
  }, [items, nodes, wraps, row]);
  const { tops, wrapped, total } = places;
  let first = 0;
  let last = items.length;
  if (items.length > VIRTUAL_FROM) {
    const bottom = view.top + (view.height || 600);
    const end = tops.findIndex((top) => top >= bottom);
    first = Math.max(0, tops.findLastIndex((top) => top <= view.top) - OVERSCAN);
    last = end < 0 ? items.length : Math.min(items.length, end + OVERSCAN);
  }
  // The focused row stays rendered, which keeps the tree reachable by Tab and lets focus land on it.
  // As item.isFocused: the focused id, else the first row.
  const { focusedItem } = tree.getState();
  let focusedIndex = items.length > 0 ? 0 : -1;
  if (focusedItem !== null) focusedIndex = places.index.get(focusedItem) ?? -1;
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
            mark={marks?.[item.getId()]}
          />
        ))}
      </div>
    </div>
  );
}

/** A thin rule between two fields of a row's meta, after a space that keeps their words apart in its description. */
const Rule = () => (
  <>
    {" "}
    <span className={rail.thin} aria-hidden />
  </>
);

const MARK: Record<Mark, { word: string; Icon: typeof Check }> = {
  done: { word: "Done", Icon: Check },
  failed: { word: "Failed", Icon: X },
  running: { word: "Running", Icon: Play },
};

/** A row's batch mark: an icon and its word, the color only repeating the word. */
function RowMark({ mark }: { mark: Mark }) {
  const { word, Icon } = MARK[mark];
  return (
    <span className={styles.mark} data-mark={mark}>
      <Icon aria-hidden />
      {word}
    </span>
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
  mark?: Mark;
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
        {/* Format and size give way first, in an ellipsis; then the status words, in one of their own. */}
        <span className={styles.facts}>
          {recording.format}
          <Rule />
          {recording.missing ? (
            <span className={styles.missing}>{recording.missing}</span>
          ) : (
            sizeOf(recording.size)
          )}
        </span>
        {(props.open || props.mark) && (
          <span className={styles.status}>
            {props.open && (
              <>
                <Rule />
                {/* The words tell the shown recording from the other open ones; color only repeats them. */}
                <span className={styles.open}>{props.active ? "Viewing" : "Open"}</span>
              </>
            )}
            {props.mark && (
              <>
                <Rule />
                <RowMark mark={props.mark} />
              </>
            )}
          </span>
        )}
      </span>
    </div>
  );
}
