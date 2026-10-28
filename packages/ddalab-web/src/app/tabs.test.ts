// The digests a tab's files hash to are remembered once, not again at each scan report that follows them.
import { expect, test, vi } from "vitest";
import { type State, useStore } from "../store/store";
import { rememberDigests } from "../store/tabs";
import "./tabs";

// The module listens to the window (pagehide), which node lacks.
vi.hoisted(() => Object.assign(globalThis, { addEventListener: () => {} }));
vi.mock("./recordings", () => ({
  closeRecording: vi.fn(),
  engine: {},
  openFiles: vi.fn(),
  openInput: vi.fn(),
}));
vi.mock("./handles", () => ({ ask: vi.fn(), fileAt: vi.fn(), permitted: vi.fn() }));
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
