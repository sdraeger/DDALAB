// The digests a tab's files hash to are remembered once, not again at each scan report that follows them.
import { expect, test, vi } from "vitest";
import { type State, useStore } from "../store/store";
import { hasHandles, rememberDigests } from "../store/tabs";
import { isUnresponsive, permitted } from "./handles";
import { requestAccess } from "./tabs";

// The module listens to the window (pagehide), which node lacks.
vi.hoisted(() => Object.assign(globalThis, { addEventListener: () => {} }));
vi.mock("./recordings", () => ({
  closeRecording: vi.fn(),
  engine: {},
  openFiles: vi.fn(),
  openInput: vi.fn(),
}));
vi.mock("./handles", () => ({
  ask: vi.fn(),
  fileAt: vi.fn(),
  isUnresponsive: vi.fn(() => false),
  permitted: vi.fn(),
}));
vi.mock("../store/tabs", async (original) => ({
  ...(await original<typeof import("../store/tabs")>()),
  rememberDigests: vi.fn(async () => {}),
}));

test("digests_are_remembered_once_while_the_scan_reports_on", async () => {
  const sha256 = { "a.edf": "ab".repeat(32) };
  const recording = (done: number) => ({
    fingerprint: "f1",
    info: { input_files: ["a.edf"] },
    scan: { done, sha256 },
  });
  useStore.setState({
    tabs: [{ fingerprint: "f1", source: { kind: "files" }, sha256 }],
  } as unknown as Partial<State>);
  // The last digest arrives, then the scan reports its progress three times with the same digests.
  for (const done of [0.1, 0.2, 0.3, 0.4]) {
    useStore.setState({ recordings: { r1: recording(done) } } as unknown as Partial<State>);
    await Promise.resolve();
  }
  expect(rememberDigests).toHaveBeenCalledTimes(1);
});

test("reattach_through_a_renamed_handle_reports_a_reason", async () => {
  vi.mocked(permitted).mockResolvedValue(true);
  const handle = {
    kind: "file",
    name: "renamed.edf",
    getFile: async () => new File([new Uint8Array(8)], "renamed.edf"),
  } as unknown as FileSystemFileHandle;
  const tab = {
    fingerprint: "f-renamed",
    name: "original.edf",
    source: {
      kind: "files" as const,
      files: [{ path: "original.edf", name: "original.edf", size: 8, lastModified: 1, handle }],
    },
  };
  useStore.setState({ tabs: [tab], recordings: {}, tabReasons: {} } as unknown as Partial<State>);
  await requestAccess(tab);
  expect(useStore.getState().tabReasons["f-renamed"]).toBe(
    "original.edf was renamed or moved since it was opened",
  );
});

test("reattach_drops_an_unresponsive_handle_and_falls_back_to_picker", async () => {
  const root = { kind: "directory", name: "data" } as FileSystemDirectoryHandle;
  vi.mocked(permitted).mockResolvedValue(false);
  vi.mocked(isUnresponsive).mockImplementation((h) => h === root);
  const tab = {
    fingerprint: "f-dead",
    name: "a.edf",
    source: {
      kind: "files" as const,
      root,
      files: [{ path: "data/a.edf", name: "a.edf", size: 8, lastModified: 1 }],
    },
  };
  useStore.setState({ tabs: [tab], recordings: {}, tabReasons: {} } as unknown as Partial<State>);
  expect(await requestAccess(tab)).toBe("fallback");
  const updated = useStore.getState().tabs.find((t) => t.fingerprint === "f-dead");
  expect(hasHandles(updated?.source ?? null)).toBe(false);
});
