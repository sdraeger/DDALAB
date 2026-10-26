// The engine's handling of its workers, against a scripted stand-in for `Worker`.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createEngine, type Engine } from "./engine";
import type { IoRequest, ScanState } from "./protocol";
import type { DDARequest } from "./types";

type Message = IoRequest & { n: number };
type OpenMessage = Extract<Message, { type: "open" }>;

class FakeWorker {
  /** The IO workers created so far, in order. */
  static io: FakeWorker[] = [];
  /** The annotation workers created so far, in order. */
  static annotators: FakeWorker[] = [];
  /** The DDA workers and hash workers created so far, in order. */
  static dda: FakeWorker[] = [];
  static hashers: FakeWorker[] = [];
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
  /** The recordings this worker has open, as the real one keeps them. */
  openIds = new Set<string>();

  constructor(url: URL) {
    if (url.pathname.includes("io.worker")) FakeWorker.io.push(this);
    if (url.pathname.includes("annotations.worker")) FakeWorker.annotators.push(this);
    if (url.pathname.includes("dda.worker")) FakeWorker.dda.push(this);
    if (url.pathname.includes("hash.worker")) FakeWorker.hashers.push(this);
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
/**
 * Every request succeeds; `open` answers with a recording named after its primary file, and refuses an id the
 * worker already has open, as the real worker does.
 */
const healthy = (worker: FakeWorker, message: Message) => {
  if (message.type === "open" && message.input.kind === "files") {
    if (worker.openIds.has(message.id)) {
      return worker.send({ n: message.n, error: `recording ${message.id} is already open`, trapped: false });
    }
    worker.openIds.add(message.id);
    worker.ok(message, {
      info: info(message.input.primary),
      fingerprint: `print-${message.input.primary}`,
      analysis_channels: [0, 1],
    });
  } else worker.ok(message, undefined);
};

beforeEach(() => {
  FakeWorker.io = [];
  FakeWorker.annotators = [];
  FakeWorker.dda = [];
  FakeWorker.hashers = [];
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
  // The second open did not make the recording: closing it is for the first.
  expect(first.duplicate).toBeUndefined();
  expect(second.duplicate).toBe(true);
  FakeWorker.io[0].fail("lost");
  await until(() => FakeWorker.io.length === 2);
  // Only the first was held: a replacement opens one recording.
  expect(FakeWorker.io[1].opens()).toHaveLength(1);
});

test("open_carries_the_analysis_channels", async () => {
  const engine = createEngine();
  expect((await engine.open(input("a.edf"))).analysis_channels).toEqual([0, 1]);
});

test("annotations_are_read_by_a_worker_of_their_own", async () => {
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  const found = { annotations: [{ onset_s: 1, duration_s: 0, label: "spike", source: "x" }], warnings: [] };
  FakeWorker.onMessage = (worker, message) => {
    if (FakeWorker.annotators.includes(worker)) worker.ok(message, found);
    else healthy(worker, message);
  };
  expect(await engine.annotations(id)).toEqual(found);
  expect(FakeWorker.annotators).toHaveLength(1);
  // The recording is opened by that worker from the same input; the IO worker is asked nothing.
  expect(FakeWorker.annotators[0].received).toMatchObject([{ input: { primary: "a.edf" } }]);
  expect(FakeWorker.io[0].received.map((m) => m.type)).toEqual(["open"]);
});

test("a_trapped_annotation_reader_is_replaced", async () => {
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  FakeWorker.onMessage = (worker, message) => {
    if (worker === FakeWorker.annotators[0]) worker.trap(message);
    else if (FakeWorker.annotators.includes(worker)) worker.ok(message, { annotations: [], warnings: [] });
    else healthy(worker, message);
  };
  await expect(engine.annotations(id)).rejects.toThrow("unreachable");
  expect(await engine.annotations(id)).toEqual({ annotations: [], warnings: [] });
  expect(FakeWorker.annotators).toHaveLength(2);
  expect(FakeWorker.annotators[0].terminated).toBe(true);
});

test("remote_recordings_above_1_gib_are_not_read_for_annotations", async () => {
  const engine = createEngine();
  FakeWorker.onMessage = (worker, message) => {
    if (message.type === "open") {
      worker.ok(message, { info: info("big.edf"), fingerprint: "print-big", analysis_channels: [0] });
    } else healthy(worker, message);
  };
  const { id } = await engine.open({
    kind: "url",
    primary: "big.edf",
    files: [{ name: "big.edf", url: "https://example.org/big.edf", size: 2 ** 30 + 1 }],
  });
  const found = await engine.annotations(id);
  expect(found.annotations).toEqual([]);
  expect(found.warnings[0]).toContain("above 1 GiB");
  expect(FakeWorker.annotators).toHaveLength(0);
});

test("a_replacement_that_never_loads_does_not_open_held_recordings_twice", async () => {
  const engine = createEngine();
  const a = await engine.open(input("a.edf"));
  const seen = states(engine, a.id);
  // W2 never sends a message; W3 loads.
  FakeWorker.onCreate = (worker) => {
    if (FakeWorker.io.length === 2) worker.fail("the worker script did not load");
  };
  FakeWorker.onMessage = (worker, message) => {
    if (message.type === "raw" && worker === FakeWorker.io[0]) worker.trap(message);
    else healthy(worker, message);
  };
  await expect(engine.raw(a.id, 0, 1)).rejects.toThrow("unreachable");
  await until(() => FakeWorker.io.length === 3);
  await engine.version();
  // One open for the recording, no error about it, and it is still held.
  expect(FakeWorker.io[2].opens().map((m) => m.id)).toEqual([a.id]);
  expect(seen.every((s) => s.error === undefined)).toBe(true);
  await engine.raw(a.id, 0, 1);
  FakeWorker.io[2].fail("lost");
  await until(() => FakeWorker.io.length === 4);
  expect(FakeWorker.io[3].opens().map((m) => m.id)).toEqual([a.id]);
  expect(seen.every((s) => s.error === undefined)).toBe(true);
});

/** Three blocks of ten windows; the IO worker plans them and stores what it is given. */
const PLAN = {
  blocks: [0, 10, 20].map((w0) => ({ w0, w1: w0 + 10, row0: 0, row1: 0 })),
  layout: { arrays: [] },
  windows: 30,
};
const REQUEST = { channels: [0] } as unknown as DDARequest;
/** The hash worker reports a.edf at once. */
const hashAtOnce = (worker: FakeWorker, message: unknown) =>
  worker.send({ id: (message as { id: string }).id, name: "a.edf", sha256: "00" });
/** `answer` decides what each DDA worker replies, `hashed` what the hash worker does. */
function runner(
  answer: (worker: FakeWorker, message: { block?: { w0: number } }) => void,
  hashed: (worker: FakeWorker, message: unknown) => void = hashAtOnce,
) {
  FakeWorker.onMessage = (worker, message) => {
    if (FakeWorker.dda.includes(worker)) answer(worker, message as { block?: { w0: number } });
    else if (FakeWorker.hashers.includes(worker)) hashed(worker, message);
    else if (message.type === "plan") worker.ok(message, PLAN);
    else healthy(worker, message);
  };
}
/** Every block is computed; the manifest asked for last is a stub. */
const computes = (worker: FakeWorker, message: { block?: { w0: number } }) =>
  worker.send({ ok: message.block ? { chunks: [] } : { schema: "ddalab.result/2" } });
const sentToIo = () => FakeWorker.io[0].received.map((m) => m.type);

test("hashes_resolve_once_every_file_is_hashed", async () => {
  runner(computes);
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  await expect(engine.hashes(id)).resolves.toEqual({ "a.edf": "00" });
});

test("hashes_resolve_on_a_hash_error_kept_apart_from_the_scan_error", async () => {
  runner(computes, (worker, message) =>
    worker.send({ id: (message as { id: string }).id, error: "the file is unreadable" }),
  );
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  await expect(engine.hashes(id)).resolves.toEqual({});
  // A scan error of its own takes `error`; the hash's stays in `hashError`.
  FakeWorker.io[0].send({ event: "scan", id, state: { scannedRows: 0, totalRows: 100, error: "no room" } });
  const seen = states(engine, id);
  await until(() => seen.at(-1)?.error === "no room");
  expect(seen.at(-1)?.hashError).toBe("The hash could not be computed: the file is unreadable");
});

test("hashes_resolve_with_what_they_have_once_the_recording_closes", async () => {
  runner(computes, () => {}); // the hashes never come
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  const waiting = engine.hashes(id);
  engine.close(id);
  await expect(waiting).resolves.toEqual({});
});

test("cancel_ends_a_run_that_waits_for_the_input_hashes", async () => {
  runner(computes, () => {}); // the hashes never come
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  const run = await engine.run(id, REQUEST);
  const written = () => sentToIo().filter((type) => type === "writeChunks").length;
  await until(() => written() === 3);
  run.cancel();
  await expect(run.done).rejects.toMatchObject({ name: "AbortError" });
  expect(sentToIo()).toContain("discardResult");
  expect(sentToIo()).not.toContain("finishResult");
  expect(FakeWorker.dda.every((w) => w.terminated)).toBe(true);
});

test("a_failed_hash_worker_lets_the_run_finish_and_says_so", async () => {
  runner(computes, (worker) => worker.fail("the hash worker crashed"));
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  const seen = states(engine, id);
  const run = await engine.run(id, REQUEST);
  await expect(run.done).resolves.toEqual({ resultId: run.id });
  expect(seen.at(-1)?.error).toBe("The hash could not be computed: the hash worker crashed");
  expect(FakeWorker.hashers[0].terminated).toBe(true);
  expect(FakeWorker.dda.flatMap((w) => w.received)).toContainEqual(
    expect.objectContaining({ extras: expect.objectContaining({ input_sha256: {} }) }),
  );
  // The next recording gets a hash worker of its own.
  await engine.open(input("b.edf"));
  expect(FakeWorker.hashers).toHaveLength(2);
});

test("a_run_writes_every_block_and_the_manifest_of_a_dda_worker", async () => {
  runner(computes);
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  const run = await engine.run(id, REQUEST);
  await expect(run.done).resolves.toEqual({ resultId: run.id });
  expect(sentToIo().filter((type) => type === "writeChunks")).toHaveLength(3);
  const finish = FakeWorker.io[0].received.find((m) => m.type === "finishResult");
  expect(finish).toMatchObject({ resultId: run.id, manifest: { schema: "ddalab.result/2" } });
  // The manifest was asked for with the input hashes; the pool ends with the run.
  expect(FakeWorker.dda.flatMap((w) => w.received)).toContainEqual(
    expect.objectContaining({ extras: expect.objectContaining({ input_sha256: { "a.edf": "00" } }) }),
  );
  expect(FakeWorker.dda.every((w) => w.terminated)).toBe(true);
});

test("cancel_terminates_the_dda_workers_and_deletes_the_files", async () => {
  runner(() => {}); // the blocks never finish
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  const run = await engine.run(id, REQUEST);
  await until(() => FakeWorker.dda.length > 0);
  run.cancel();
  await expect(run.done).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.dda.every((w) => w.terminated)).toBe(true);
  expect(sentToIo()).toContain("discardResult");
  expect(sentToIo()).not.toContain("finishResult");
});

test("a_text_recording_gets_one_worker_per_512_mib", async () => {
  runner(() => {});
  FakeWorker.onMessage = ((next) => (worker: FakeWorker, message: Message) => {
    if (message.type !== "open") return next(worker, message);
    const csv = { ...info("big.csv"), format: "CSV" };
    worker.ok(message, { info: csv, fingerprint: "print-csv", analysis_channels: [0] });
  })(FakeWorker.onMessage);
  const engine = createEngine();
  const open = (size: number) =>
    engine.open({
      kind: "url",
      primary: "big.csv",
      files: [{ name: "big.csv", url: "https://x/big.csv", size }],
    });
  const cores = Math.max(1, navigator.hardwareConcurrency - 1);
  expect((await engine.plan((await open(600 * 2 ** 20)).id, REQUEST)).workers).toBe(1);
  expect((await engine.plan((await open(200 * 2 ** 20)).id, REQUEST)).workers).toBe(Math.min(cores, 2));
  expect((await engine.plan((await open(1000)).id, REQUEST)).workers).toBe(cores);
});

test("a_trapped_dda_worker_fails_the_run_with_its_message", async () => {
  runner((worker, message) =>
    message.block?.w0 === 10
      ? worker.send({ error: "unreachable", trapped: true })
      : worker.send({ ok: { chunks: [] } }),
  );
  const engine = createEngine();
  const { id } = await engine.open(input("a.edf"));
  const run = await engine.run(id, REQUEST);
  await expect(run.done).rejects.toThrow("unreachable");
  expect(FakeWorker.dda.every((w) => w.terminated)).toBe(true);
  expect(sentToIo()).toContain("discardResult");
  expect(sentToIo()).not.toContain("finishResult");
});
