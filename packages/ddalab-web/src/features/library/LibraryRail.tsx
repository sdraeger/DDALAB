// The library rail: opening recordings (picker, folder, drop anywhere in the window), the recent ones, OpenNeuro and
// the history of results. The open ones are the tabs over the canvas.

import { Popover } from "@base-ui/react/popover";
import FilePlus from "lucide-react/dist/esm/icons/file-plus.mjs";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open.mjs";
import {
  type ChangeEvent,
  lazy,
  memo,
  Suspense,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { engineVersion } from "../../app/analyses";
import { beside } from "../../app/handles";
import { consumeLaunches, grantedRoots, launchQueue, openLaunched } from "../../app/launch";
import {
  canPickFiles,
  type FileHandles,
  forget,
  type Outcome,
  openFiles,
  pickFiles,
  reopen,
} from "../../app/recordings";
import type { FolderSource } from "../../core/folder";
import { droppedFiles, isProject } from "../../core/sources";
import type { RecentEntry } from "../../store/recent";
import { useStore } from "../../store/store";
import controls from "../../styles/controls.module.css";
import styles from "./LibraryRail.module.css";

// A chunk that does not load (offline after a deploy) leaves a note: without the catch it would unmount the app.
const OpenNeuroPanel = lazy(() =>
  import("../openneuro/OpenNeuroPanel").then(
    (module) => ({ default: module.OpenNeuroPanel }),
    () => ({ default: OpenNeuroMissing }),
  ),
);

function OpenNeuroMissing() {
  return <p className={styles.hint}>OpenNeuro search did not load. Reload the page to use it.</p>;
}
const HistoryRail = lazy(() => import("../history/HistoryRail"));
const ProjectExport = lazy(() =>
  import("./ProjectExport").catch(() => ({
    default: () => <p className={styles.hint}>The export did not load. Reload the page to export.</p>,
  })),
);
// Loaded the first time a folder opens.
const FolderTree = lazy(() =>
  import("./FolderTree").catch(() => ({
    default: () => (
      <p className={styles.hint}>The folder view did not load. Reload the page to open folders.</p>
    ),
  })),
);

type DirectoryPicker = (options: { mode: "read" }) => Promise<FileSystemDirectoryHandle>;

/** The rail's opens, as the application menu and its shortcuts run them (app/AppMenu.tsx); set while it is mounted. */
export const railActions = { openFiles() {}, openFolder() {}, openProject() {} };
/** The Export project popover, which the application menu opens too, by its trigger's id. */
export const exportPanel = Popover.createHandle();
export const EXPORT_TRIGGER = "export-project";

const version = engineVersion.then(
  (v) => v.engine_version,
  (error: Error) => `failed: ${error.message}`,
);

/**
 * Opens the project `file`, one of the attempt's files, with its handle where the browser gives one. The project code
 * loads with the first.
 */
async function openProjectIn(file: File, { files, handle, handles }: Attempt): Promise<Outcome> {
  const own = handles?.files?.[files.indexOf(file)] ?? (handle?.kind === "file" ? handle : undefined);
  try {
    const { openProject } = await import("../../app/project");
    return await openProject(file, own as FileSystemFileHandle | undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message: `${file.name} could not be opened: ${message}`, folder: false };
  }
}

/** The files of one attempt to open, kept for when the user chooses among several recordings. */
interface Attempt {
  files: File[];
  handle?: FileSystemHandle;
  /** The handles of `files` (Chromium), which let their tab reattach on the next visit. */
  handles?: FileHandles;
  expect?: string;
}

export const LibraryRail = memo(function LibraryRail() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [opening, setOpening] = useState(false);
  // `resume`: the batch the history resumes on this folder once it is read.
  const [folder, setFolder] = useState<{ source: FolderSource; key: number; resume?: string } | null>(null);
  const showFolder = (source: FolderSource, resume?: string) => {
    // Another folder drops the last batch's outcome and marks; a batch still running keeps its progress.
    if (useStore.getState().batch?.status !== "running") useStore.setState({ batch: null });
    setFolder((shown) => ({ source, key: (shown?.key ?? 0) + 1, resume }));
  };
  const recent = useStore((s) => s.recent);
  // The hint is for a first open: it goes once a recording has a tab.
  const untouched = useStore((s) => s.tabs.length === 0);
  const attempt = useRef<Attempt>({ files: [] });
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // The recording the next pick is meant to locate again.
  const locating = useRef<string | undefined>(undefined);

  async function run(next: Attempt, choice?: string) {
    attempt.current = next;
    setOpening(true);
    try {
      const project = next.files.find((file) => isProject(file.name));
      setOutcome(
        project ? await openProjectIn(project, next) : await openFiles(next.files, { ...next, choice }),
      );
    } finally {
      setOpening(false);
    }
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void run({ files, expect: locating.current });
    locating.current = undefined;
  };
  /** `project`: the picker offers .ddalab projects only. */
  async function chooseFiles(expect?: string, project = false) {
    locating.current = expect;
    // The <input> opens only in the task of the click that asked for it, before any await.
    if (!canPickFiles() && filesInput.current) {
      filesInput.current.accept = project ? ".ddalab" : "";
      return filesInput.current.click();
    }
    const chosen = await pickFiles(project).catch(() => null); // null: the user closed the picker
    locating.current = undefined;
    if (chosen) await run({ ...chosen, expect });
  }
  const pickedFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    showFolder({ kind: "files", files });
  };
  async function openFolder() {
    locating.current = undefined;
    // A header opened alone (a .vhdr from the picker or launched by the system) has its handle: when the folder chosen
    // holds it, the recording opens from there with its companions, where the tree would ask for another click.
    const lone =
      outcome?.kind === "error" && outcome.folder ? attempt.current.handles?.files?.[0] : undefined;
    const pick = (window as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
    if (!pick) return folderInput.current?.click();
    const handle = await pick({ mode: "read" }).catch(() => null); // null: the user closed the picker
    if (!handle) return;
    const found = lone && (await beside(handle, lone).catch(() => undefined));
    if (found) return void run({ files: found.files, handles: found.handles }, found.choice);
    showFolder({ kind: "handle", handle });
  }
  async function open(entry: RecentEntry) {
    if (!entry.handle) return chooseFiles(entry.fingerprint);
    setOpening(true);
    setOutcome(await reopen({ ...entry, handle: entry.handle }));
    setOpening(false);
  }

  // Files dropped anywhere in the window open; without this the browser would replace the page with the file.
  const dropped = useEffectEvent(async (data: DataTransfer) => {
    locating.current = undefined;
    // A dropped folder is walked into the tree. The item list empties when the event ends: read it before any await.
    const items = Array.from(data.items).filter((item) => item.kind === "file");
    const entries = items.map((item) => item.webkitGetAsEntry()).filter((entry) => entry !== null);
    if (entries.some((entry) => entry.isDirectory)) {
      // Chromium also gives a single dropped folder as a handle, which keeps its files' handles through the walk.
      const item = items[0] as DataTransferItem & {
        getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
      };
      // shortcut: several dropped folders keep no folder handle (their tabs reattach by picker); ask each item for
      // its handle before the first await if that matters.
      const pending = entries.length === 1 ? item.getAsFileSystemHandle?.() : undefined;
      const handle = await pending?.catch(() => null);
      return showFolder(
        handle?.kind === "directory"
          ? { kind: "handle", handle: handle as FileSystemDirectoryHandle }
          : { kind: "entries", entries },
      );
    }
    await run(await droppedFiles(data));
  });
  // Files the system opens the installed app with (Chromium). The consumer is set once, when the rail first mounts.
  const launched = useEffectEvent(async (handles: FileSystemFileHandle[]) => {
    locating.current = undefined;
    if (handles.some((handle) => isProject(handle.name))) {
      return run({ files: await Promise.all(handles.map((h) => h.getFile())), handles: { files: handles } });
    }
    setOpening(true);
    try {
      const result = await openLaunched(handles, { open: openFiles, roots: grantedRoots });
      attempt.current = result.attempt;
      setOutcome(result.outcome);
    } finally {
      setOpening(false);
    }
  });
  useEffect(() => consumeLaunches(launchQueue(), (handles) => void launched(handles)), []);
  useEffect(() => {
    Object.assign(railActions, {
      openFiles: () => void chooseFiles(),
      openFolder: () => void openFolder(),
      openProject: () => void chooseFiles(undefined, true),
    });
  });
  useEffect(() => {
    const over = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) void dropped(event.dataTransfer);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className={styles.rail}>
      <section className={styles.section} aria-label="Drop zone">
        <div className={styles.actions}>
          <button type="button" className={controls.primary} onClick={() => chooseFiles()}>
            <FilePlus aria-hidden />
            Open files
          </button>
          <button type="button" className={controls.button} onClick={() => openFolder()}>
            <FolderOpen aria-hidden />
            Open folder
          </button>
        </div>
        {untouched ? (
          <p className={styles.hint}>
            Or drop a recording, the folder that holds it, or a .ddalab project anywhere in this window.
          </p>
        ) : (
          <Popover.Root handle={exportPanel}>
            <Popover.Trigger
              id={EXPORT_TRIGGER}
              className={`${controls.quiet} ${styles.ghost} ${styles.start}`}
            >
              Export project
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={6} align="start">
                <Popover.Popup className={controls.panel}>
                  <Suspense fallback={null}>
                    <ProjectExport />
                  </Suspense>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        )}
        <input ref={filesInput} type="file" multiple hidden aria-label="Recording files" onChange={picked} />
        <input
          ref={folderInput}
          type="file"
          hidden
          aria-label="Recording folder"
          onChange={pickedFolder}
          {...{ webkitdirectory: "" }}
        />
        <Notice
          outcome={outcome}
          opening={opening}
          onChoose={(choice) => run(attempt.current, choice)}
          onFolder={openFolder}
        />
      </section>
      <Recent entries={recent} onOpen={open} />
      {folder && (
        <Suspense fallback={null}>
          <FolderTree
            key={folder.key}
            source={folder.source}
            resume={folder.resume}
            // The tree shows how its own opens went, beside its rows.
            onOpen={(recording, handles) => openFiles(recording.files, { choice: recording.path, handles })}
            onClose={() => setFolder(null)}
          />
        </Suspense>
      )}
      <Suspense>
        <OpenNeuroPanel />
      </Suspense>
      <Suspense fallback={null}>
        <HistoryRail onResume={showFolder} />
      </Suspense>
      <p className={styles.footer}>
        Engine{" "}
        <Suspense fallback={<output>loading</output>}>
          <EngineVersion />
        </Suspense>
      </p>
    </div>
  );
});

function EngineVersion() {
  return <output>{use(version)}</output>;
}

function Notice(props: {
  outcome: Outcome | null;
  opening: boolean;
  onChoose(choice: string): void;
  onFolder(): void;
}) {
  const { outcome } = props;
  // Keyed: a notice of another kind mounts anew and fades in, where React would reuse the paragraph.
  if (props.opening) {
    return (
      <p key="opening" className={styles.hint} aria-live="polite">
        Opening
      </p>
    );
  }
  if (outcome?.kind === "error") {
    return (
      <div key="error" role="alert" className={styles.error}>
        <p>{outcome.message}</p>
        {outcome.folder && (
          <button type="button" className={`${controls.quiet} ${styles.ghost}`} onClick={props.onFolder}>
            Open the folder that contains it.
          </button>
        )}
      </div>
    );
  }
  if (outcome?.kind === "choose") {
    return (
      <fieldset key="choose" className={styles.choose} data-appear>
        <legend>Several recordings found</legend>
        {outcome.candidates.map((path) => (
          <button type="button" className={controls.quiet} key={path} onClick={() => props.onChoose(path)}>
            {path}
          </button>
        ))}
      </fieldset>
    );
  }
  return outcome?.kind === "opened" && outcome.warning ? (
    <p key="warning" role="alert" className={styles.error}>
      {outcome.warning}
    </p>
  ) : null;
}

function Recent(props: { entries: RecentEntry[]; onOpen(entry: RecentEntry): void }) {
  const open = useStore(useShallow((s) => Object.values(s.recordings).map((r) => r.fingerprint)));
  if (props.entries.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Recent recordings" data-appear>
      <h2 className={styles.heading}>
        Recent <span className={styles.count}>{props.entries.length}</span>
      </h2>
      <ul className={styles.entries}>
        {props.entries.map((entry) => (
          <li key={entry.fingerprint} className={styles.recent} data-appear>
            <span className={styles.entryName} title={entry.names.join(", ")}>
              {entry.primary}
            </span>
            {!entry.handle && !open.includes(entry.fingerprint) && (
              <span className={styles.entryMeta}>Select the file again to reopen it. </span>
            )}
            <span className={styles.recentActions}>
              <button
                type="button"
                className={controls.quiet}
                aria-label={`${entry.handle ? "Reopen" : "Locate"} ${entry.primary}`}
                onClick={() => props.onOpen(entry)}
              >
                {entry.handle ? "Reopen" : "Locate"}
              </button>
              <button
                type="button"
                className={controls.quiet}
                aria-label={`Forget ${entry.primary}`}
                onClick={() => forget(entry)}
              >
                Forget
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
