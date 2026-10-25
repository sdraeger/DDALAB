// The engine's handling of its workers, against a scripted stand-in for `Worker`.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createEngine, type Engine } from "./engine";
import type { IoRequest, ScanState } from "./protocol";

type Message = IoRequest & { n: number };
type OpenMessage = Extract<Message, { type: "open" }>;

class FakeWorker {
  /** The IO workers created so far, in order. */
  static io: FakeWorker[] = [];
  /** Decides what a new worker does; runs before the engine attaches its handlers. */
  static onCreate: (worker: FakeWorker) => void = () => {};
  /** Decides what a worker answers to a message. */
  static onMessage: (worker: FakeWorker, message: Message) => void = () => {};

  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  received: Message[] = [];
  terminated = false;
  /** A worker that failed answers nothing. */
  dead = false;

  constructor(url: URL) {
    if (url.pathname.includes("io.worker")) FakeWorker.io.push(this);
    FakeWorker.onCreate(this);
  }
  postMessage(message: Message) {
    this.received.push(message);
    if (!this.dead) queueMicrotask(() => !this.terminated && FakeWorker.onMessage(this, message));
  }
  terminate() {
    this.terminated = true;
  }
  /** Delivers `data` once the engine has attached its handlers. */
  send(data: unknown) {
    queueMicrotask(() => !this.terminated && this.onmessage?.({ data }));
  }
  fail(message: string) {
    this.dead = true;
    queueMicrotask(() => !this.terminated && this.onerror?.({ message }));
  }
  ok(message: Message, ok: unknown) {
    this.send({ n: message.n, ok });
  }
  trap(message: Message, error = "unreachable") {
    this.send({ n: message.n, error, trapped: true });
  }
  opens() {
    return this.received.filter((m): m is OpenMessage => m.type === "open");
  }
}

const info = (name: string) => ({ sample_count: 100, input_files: [name], channels: [] });
const file = (name: string) => new File(["x"], name);
const input = (name: string) => ({ kind: "files" as const, files: [file(name)], primary: name });
/** Every request succeeds; `open` answers with a recording named after its primary file. */
const healthy = (worker: FakeWorker, message: Message) => {
  if (message.type === "open" && message.input.kind === "files") {
    worker.ok(message, {
      info: info(message.input.primary),
      fingerprint: `print-${message.input.primary}`,
      analysis_channels: [0, 1],
    });
  } else worker.ok(message, undefined);
};

beforeEach(() => {
  FakeWorker.io = [];
  FakeWorker.onCreate = () => {};
  FakeWorker.onMessage = healthy;
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

/** Resolves once `check` holds, letting queued messages run. */
const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true));
const states = (engine: Engine, id: string) => {
  const seen: ScanState[] = [];
  engine.onScan(id, (state) => seen.push(state));
  return seen;
};

test("start_failures_stop_after_three_replacements", async () => {
  FakeWorker.onCreate = (worker) => worker.fail("the worker script did not load");
  const engine = createEngine();
  // The request waits through the replacements and fails with the last reason.
  await expect(engine.version()).rejects.toThrow(
    "The engine could not start: the worker script did not load",
  );
  expect(FakeWorker.io).toHaveLength(4);
  await expect(engine.version()).rejects.toThrow("The engine could not start");
  await expect(engine.open(input("a.edf"))).rejects.toThrow("The engine could not start");
  expect(FakeWorker.io).toHaveLength(4);
});

test("a_reply_resets_the_failure_count", async () => {
  const engine = createEngine();
  await engine.version();
  // Eight workers in a row load, answer and then stop: more than the cap, but never without a reply.
  for (let i = 1; i <= 8; i++) {
    FakeWorker.io.at(-1)?.fail("lost");
    await until(() => FakeWorker.io.length === i + 1);
    await engine.version();
  }
  expect(FakeWorker.io).toHaveLength(9);
});

test("a_trap_opens_held_recordings_again_under_their_ids", async () => {
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  FakeWorker.onMessage = (worker, message) => {
    if (message.type === "raw" && worker === FakeWorker.io[0]) worker.trap(message);
    else healthy(worker, message);
  };
  await expect(engine.raw(id, 0, 4)).rejects.toThrow("The engine stopped unexpectedly: unreachable");
  await engine.raw(id, 0, 4);
  expect(FakeWorker.io).toHaveLength(2);
  expect(FakeWorker.io[0].terminated).toBe(true);
  expect(FakeWorker.io[1].opens()).toMatchObject([{ id, input: { primary: "a.edf" } }]);
});

test("a_recording_that_fails_to_reopen_is_forgotten_and_reported", async () => {
  const engine = createEngine();
  const a = await engine.open(input("a.edf"));
  const b = await engine.open(input("b.edf"));
  const seen = states(engine, a.id);
  FakeWorker.onMessage = (worker, message) => {
    if (message.type === "raw" && worker === FakeWorker.io[0]) worker.trap(message);
    else if (message.type === "open" && message.id === a.id) {
      worker.send({ n: message.n, error: "a.edf is gone", trapped: false });
    } else healthy(worker, message);
  };
  await expect(engine.raw(b.id, 0, 1)).rejects.toThrow("unreachable");
  await until(() => seen.some((s) => s.error?.includes("a.edf is gone")));
  // The next replacement opens only b.
  FakeWorker.io.at(-1)?.fail("lost");
  await until(() => FakeWorker.io.length === 3);
  expect(FakeWorker.io[2].opens().map((m) => m.id)).toEqual([b.id]);
});

test("a_reopen_cut_short_by_another_restart_is_kept", async () => {
  const engine = createEngine();
  const a = await engine.open(input("a.edf"));
  const seen = states(engine, a.id);
  FakeWorker.onMessage = (worker, message) => {
    if (message.type === "raw" && worker === FakeWorker.io[0]) worker.trap(message);
    else if (message.type === "open" && worker === FakeWorker.io[1])
      worker.trap(message, "unreachable again");
    else healthy(worker, message);
  };
  await expect(engine.raw(a.id, 0, 1)).rejects.toThrow("unreachable");
  await until(() => FakeWorker.io.length === 3);
  await until(() => FakeWorker.io[2].opens().length === 1);
  expect(FakeWorker.io[2].opens()[0]).toMatchObject({ id: a.id });
  expect(seen.every((s) => s.error === undefined)).toBe(true);
});

test("opening_a_recording_that_is_open_returns_its_id", async () => {
  const engine = createEngine();
  FakeWorker.onMessage = (worker, message) => {
    if (message.type === "open" && message.input.kind === "files") {
      const first = FakeWorker.io[0].opens()[0];
      worker.ok(message, {
        info: info("a.edf"),
        fingerprint: "print-a.edf",
        analysis_channels: [0, 1],
        // The worker found the fingerprint among its recordings: the second open names the first.
        duplicateOf: message === first ? undefined : first.id,
      });
    } else healthy(worker, message);
  };
  const first = await engine.open(input("a.edf"));
  const second = await engine.open(input("a.edf"));
  expect(second.id).toBe(first.id);
  FakeWorker.io[0].fail("lost");
  await until(() => FakeWorker.io.length === 2);
  // Only the first was held: a replacement opens one recording.
  expect(FakeWorker.io[1].opens()).toHaveLength(1);
});

test("open_carries_the_analysis_channels", async () => {
  const engine = createEngine();
  expect((await engine.open(input("a.edf"))).analysis_channels).toEqual([0, 1]);
});
