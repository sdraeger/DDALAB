// The application menu, as a desktop app has one: the DDALAB mark and wordmark in the command bar open File, View,
// Window and Help, and the commands with a shortcut take it anywhere in the window (⌘ on a Mac, Ctrl elsewhere). Each
// command runs the code of the bar's or the rail's own control. Browsers do not let a page focus another of its windows,
// so the Window menu lists the saved windows to reopen and not the open ones. A chunk of its own, which keeps Base UI's
// menus out of the first load: until it arrives the bar draws the mark and wordmark alone (Brand in Shell.tsx).
import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";
import { Popover } from "@base-ui/react/popover";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { EXPORT_TRIGGER, exportPanel, railActions } from "../features/library/LibraryRail";
import { ariaKeys, isShortcut, printed, SHORTCUTS, type Shortcut } from "../features/tabs/keys";
import { setTheme, togglePanel, useStore } from "../store/store";
import { openWindow, reopenable, type SavedWindow } from "../store/windows";
import controls from "../styles/controls.module.css";
import styles from "./AppMenu.module.css";
import { Logo } from "./Logo";
import { ABOUT_TRIGGER, aboutPanel, CALIBRATION_TRIGGER, calibrationPanel, toggle } from "./Shell";
import { closeTab } from "./tabs";
import { inTransition } from "./viewTransition";

const Shortcuts = lazy(() => import("../features/settings/About").then((m) => ({ default: m.Shortcuts })));

interface Command {
  label: string;
  shortcut?: Shortcut;
  run(): void;
}

function exportProject() {
  const { tabs, panels } = useStore.getState();
  if (tabs.length === 0) return;
  // The popover hangs from the rail's Export project.
  if (!panels.library) togglePanel("library");
  requestAnimationFrame(() => exportPanel.open(EXPORT_TRIGGER));
}

const COMMANDS = {
  openFiles: { label: "Open files", shortcut: SHORTCUTS.openFiles, run: () => railActions.openFiles() },
  openFolder: { label: "Open folder", shortcut: SHORTCUTS.openFolder, run: () => railActions.openFolder() },
  openProject: { label: "Open project", run: () => railActions.openProject() },
  exportProject: { label: "Export project", shortcut: SHORTCUTS.exportProject, run: exportProject },
  closeRecording: {
    label: "Close recording",
    run: () => {
      const { activeTab } = useStore.getState();
      if (activeTab) closeTab(activeTab);
    },
  },
  library: { label: "Library", shortcut: SHORTCUTS.library, run: () => toggle("library") },
  inspector: { label: "Inspector", shortcut: SHORTCUTS.inspector, run: () => toggle("inspector") },
  calibration: {
    label: "Calibration",
    shortcut: SHORTCUTS.calibration,
    run: () => calibrationPanel.open(CALIBRATION_TRIGGER),
  },
  newWindow: { label: "New window", shortcut: SHORTCUTS.newWindow, run: () => openWindow("new") },
} satisfies Record<string, Command>;

/** The menu's shortcuts, anywhere in the window. */
function useMenuKeys() {
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = Object.values(COMMANDS).find(
        (c: Command) => c.shortcut && isShortcut(event, c.shortcut),
      );
      if (!command) return;
      event.preventDefault();
      command.run();
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);
}

export default function AppMenu() {
  const { library, inspector } = useStore((s) => s.panels);
  const theme = useStore((s) => s.theme);
  const hasTabs = useStore((s) => s.tabs.length > 0);
  const hasActive = useStore((s) => s.activeTab !== null);
  const [saved, setSaved] = useState<[string, SavedWindow][]>([]);
  const [shortcuts, setShortcuts] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useMenuKeys();
  // The saved windows are listed again each time the menu opens: other windows open and close meanwhile.
  const listWindows = (open: boolean) => {
    if (open) reopenable().then(setSaved, () => setSaved([]));
  };
  // A heading takes no name from the menubar inside it: it is named outright.
  return (
    <h1 className={styles.brand} aria-label="DDALAB">
      <Menubar render={<span />} className={styles.menubar}>
        <Menu.Root onOpenChange={listWindows}>
          <Menu.Trigger ref={trigger} className={styles.trigger}>
            <Logo />
            <span className={styles.wordmark}>DDALAB</span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="start">
              <Menu.Popup className={`${controls.popup} ${styles.menu}`}>
                <Submenu label="File">
                  <Item command={COMMANDS.openFiles} />
                  <Item command={COMMANDS.openFolder} />
                  <Item command={COMMANDS.openProject} />
                  <Item command={COMMANDS.exportProject} disabled={!hasTabs} />
                  <Menu.Separator className={styles.separator} />
                  <Item command={COMMANDS.closeRecording} disabled={!hasActive} />
                </Submenu>
                <Submenu label="View">
                  <Toggle command={COMMANDS.library} checked={library} />
                  <Toggle command={COMMANDS.inspector} checked={inspector} />
                  <Menu.Separator className={styles.separator} />
                  <Menu.RadioGroup
                    value={theme ?? "system"}
                    onValueChange={(value) =>
                      inTransition(() => setTheme(value === "system" ? null : (value as "light" | "dark")))
                    }
                  >
                    <Menu.GroupLabel className={styles.group}>Theme</Menu.GroupLabel>
                    {["Light", "Dark", "System"].map((name) => (
                      <Menu.RadioItem
                        key={name}
                        value={name.toLowerCase()}
                        className={styles.item}
                        closeOnClick
                      >
                        <Menu.RadioItemIndicator className={styles.check}>
                          <Check aria-hidden />
                        </Menu.RadioItemIndicator>
                        <span className={styles.label}>{name}</span>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                  <Menu.Separator className={styles.separator} />
                  <Item command={COMMANDS.calibration} />
                </Submenu>
                <Submenu label="Window">
                  <Item command={COMMANDS.newWindow} />
                  <Menu.Separator className={styles.separator} />
                  {saved.length === 0 ? (
                    <Menu.Item className={styles.item} disabled>
                      <span className={styles.label}>Reopen window</span>
                    </Menu.Item>
                  ) : (
                    <Menu.Group>
                      <Menu.GroupLabel className={styles.group}>Reopen window</Menu.GroupLabel>
                      {saved.map(([id, record]) => {
                        const names = record.tabs.map((t) => t.name).join(", ");
                        return (
                          <Menu.Item
                            key={id}
                            className={styles.item}
                            title={names}
                            onClick={() => openWindow(id)}
                          >
                            <span className={styles.label}>{names}</span>
                          </Menu.Item>
                        );
                      })}
                    </Menu.Group>
                  )}
                </Submenu>
                <Submenu label="Help">
                  <Menu.Item className={styles.item} onClick={() => setShortcuts(true)}>
                    <span className={styles.label}>Keyboard shortcuts</span>
                  </Menu.Item>
                  <Menu.Item className={styles.item} onClick={() => aboutPanel.open(ABOUT_TRIGGER)}>
                    <span className={styles.label}>About DDALAB</span>
                  </Menu.Item>
                </Submenu>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </Menubar>
      <Popover.Root open={shortcuts} onOpenChange={setShortcuts}>
        <Popover.Portal>
          <Popover.Positioner anchor={trigger} sideOffset={6} align="start">
            <Popover.Popup className={controls.panel} finalFocus={trigger}>
              <Suspense fallback={null}>
                <Shortcuts />
              </Suspense>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </h1>
  );
}

function Submenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={styles.item}>
        <span className={styles.label}>{label}</span>
        <ChevronRight aria-hidden className={styles.more} />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner alignOffset={-5}>
          <Menu.Popup className={`${controls.popup} ${styles.menu}`}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** The shortcut beside a command. */
function Keys({ command }: { command: Command }) {
  return command.shortcut ? <kbd className={styles.keys}>{printed(command.shortcut)}</kbd> : null;
}

function Item({ command, disabled }: { command: Command; disabled?: boolean }) {
  return (
    <Menu.Item
      className={styles.item}
      disabled={disabled}
      onClick={command.run}
      aria-keyshortcuts={command.shortcut && ariaKeys(command.shortcut)}
    >
      <span className={styles.label}>{command.label}</span>
      <Keys command={command} />
    </Menu.Item>
  );
}

function Toggle({ command, checked }: { command: Command; checked: boolean }) {
  return (
    <Menu.CheckboxItem
      className={styles.item}
      checked={checked}
      onCheckedChange={command.run}
      closeOnClick
      aria-keyshortcuts={command.shortcut && ariaKeys(command.shortcut)}
    >
      <Menu.CheckboxItemIndicator className={styles.check}>
        <Check aria-hidden />
      </Menu.CheckboxItemIndicator>
      <span className={styles.label}>{command.label}</span>
      <Keys command={command} />
    </Menu.CheckboxItem>
  );
}
