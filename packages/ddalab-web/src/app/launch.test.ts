// The launch consumer and what it opens, with stub handles: the browser's launch queue and real folders are not here.
import { expect, test, vi } from "vitest";
import { consumeLaunches, type LaunchParams, openLaunched } from "./launch";
import type { Outcome } from "./recordings";

type Handle = FileSystemFileHandle;
const fileHandle = (name: string, kind = "file") =>
  ({ kind, name, getFile: async () => new File([name], name) }) as unknown as Handle;
/** A folder holding `entries`; `resolve` answers the path of a handle it holds somewhere below. */
const folder = (name: string, entries: Handle[], below: Record<string, string[]> = {}) =>
  ({
    kind: "directory",
    name,
    resolve: async (handle: Handle) => below[handle.name] ?? null,
    getDirectoryHandle: async () => folder("sub", entries),
    async *values() {
      yield* entries;
    },
  }) as unknown as FileSystemDirectoryHandle;

const opened: Outcome = { kind: "opened", id: "r1" };
const missing: Outcome = {
  kind: "error",
  message: "fixture.vhdr names fixture.eeg, which is not among the opened files",
  folder: true,
};

test("every_launch_with_files_reaches_the_opener_and_nothing_else_does", () => {
  const open = vi.fn();
  let consumer: ((params: LaunchParams) => void) | undefined;
  consumeLaunches({ setConsumer: (c) => (consumer = c) }, open);
  const [a, b] = [fileHandle("a.edf"), fileHandle("b.edf")];
  consumer?.({ files: [a, fileHandle("dir", "directory"), b] });
  expect(open).toHaveBeenCalledExactlyOnceWith([a, b]);
  consumer?.({ files: [] });
  consumer?.({ files: [fileHandle("dir", "directory")] });
  expect(open).toHaveBeenCalledTimes(1);
  consumer?.({ files: [b] });
  expect(open).toHaveBeenLastCalledWith([b]);
});

test("a_browser_without_a_launch_queue_is_left_alone", () => {
  expect(() => consumeLaunches(undefined, vi.fn())).not.toThrow();
});

test("one_launched_file_opens_with_its_handle_for_the_tab_and_the_recent_list", async () => {
  const handle = fileHandle("a.edf");
  const open = vi.fn(async () => opened);
  const roots = vi.fn(async () => []);
  const { attempt, outcome } = await openLaunched([handle], { open, roots });
  expect(outcome).toBe(opened);
  expect(open).toHaveBeenCalledExactlyOnceWith(attempt.files, attempt);
  expect(attempt.files.map((f) => f.name)).toEqual(["a.edf"]);
  expect(attempt.handle).toBe(handle);
  expect(attempt.handles).toEqual({ files: [handle] });
  expect(roots).not.toHaveBeenCalled();
});

test("several_launched_files_open_together_without_a_single_handle", async () => {
  const handles = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) => fileHandle(name));
  const open = vi.fn(async () => opened);
  const { attempt } = await openLaunched(handles, { open, roots: async () => [] });
  expect(attempt.handle).toBeUndefined();
  expect(attempt.handles.files).toEqual(handles);
});

test("a_header_alone_is_looked_for_in_the_granted_folders", async () => {
  const vhdr = fileHandle("fixture.vhdr");
  const beside = ["fixture.vhdr", "fixture.eeg", "fixture.vmrk"].map((name) => fileHandle(name));
  const elsewhere = folder("other", [], {});
  const root = folder("study", beside, { "fixture.vhdr": ["sub", "fixture.vhdr"] });
  const open = vi.fn(async (files: File[]) => (files.length === 1 ? missing : opened));
  const { attempt, outcome } = await openLaunched([vhdr], { open, roots: async () => [elsewhere, root] });
  expect(outcome).toBe(opened);
  expect(open).toHaveBeenCalledTimes(2);
  const [files, options] = open.mock.calls[1] as unknown as [File[], { choice: string; handles: object }];
  expect(files.map((f) => f.webkitRelativePath)).toEqual([
    "study/sub/fixture.vhdr",
    "study/sub/fixture.eeg",
    "study/sub/fixture.vmrk",
  ]);
  expect(options.choice).toBe("study/sub/fixture.vhdr");
  expect(options.handles).toEqual({ files: beside, root });
  expect(attempt.files).toBe(files);
});

test("a_header_alone_stays_a_message_when_no_granted_folder_holds_it", async () => {
  const vhdr = fileHandle("fixture.vhdr");
  const open = vi.fn(async () => missing);
  const { attempt, outcome } = await openLaunched([vhdr], {
    open,
    roots: async () => [folder("other", [])],
  });
  expect(outcome).toBe(missing);
  expect(open).toHaveBeenCalledTimes(1);
  expect(attempt.handles.files).toEqual([vhdr]);
});

test("a_folder_that_cannot_be_asked_is_skipped", async () => {
  const vhdr = fileHandle("fixture.vhdr");
  const broken = { ...folder("broken", []), resolve: async () => Promise.reject(new Error("gone")) };
  const open = vi.fn(async () => missing);
  const { outcome } = await openLaunched([vhdr], { open, roots: async () => [broken] });
  expect(outcome).toBe(missing);
});

test("another_error_does_not_search_the_folders", async () => {
  const roots = vi.fn(async () => []);
  const failed: Outcome = { kind: "error", message: "not a format DDALAB reads", folder: false };
  const { outcome } = await openLaunched([fileHandle("a.dat2")], { open: async () => failed, roots });
  expect(outcome).toBe(failed);
  expect(roots).not.toHaveBeenCalled();
});
