// public/sw.js, baked for a small build, run against stub worker globals: what it keeps, what it answers, what it
// leaves to the network, and what it deletes when it activates.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { bakeServiceWorker, precacheOf } from "./precache.mjs";

const SCOPE = "https://example.test/app/";
let dir;
let build;
let source;
/** The worker of another build: one more file in the folder gives it another version. */
const variant = () => {
  const other = mkdtempSync(join(tmpdir(), "sw-variant-"));
  cpSync(dir, other, { recursive: true });
  writeFileSync(join(other, "extra.txt"), "another build");
  bakeServiceWorker(other);
  const code = readFileSync(join(other, "sw.js"), "utf8");
  rmSync(other, { recursive: true });
  return code;
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sw-"));
  mkdirSync(join(dir, "assets"));
  for (const file of ["index.html", "manifest.webmanifest", "assets/app-1.js", "assets/engine.wasm"])
    writeFileSync(join(dir, file), file);
  bakeServiceWorker(dir);
  build = precacheOf(dir);
  source = readFileSync(join(dir, "sw.js"), "utf8");
});
afterAll(() => rmSync(dir, { recursive: true }));

/** The worker running against stubs; `store` maps cache names to their entries (url to body). */
function start(store = new Map(), windows = 0, code = source) {
  const handlers = {};
  const calls = { claim: 0, skipWaiting: 0, fetched: [], installed: [] };
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return {
      addAll: async (requests) => {
        calls.installed.push(...requests.map((r) => [r.url, r.cache]));
        for (const r of requests) store.get(name).set(r.url, `cached ${r.url}`);
      },
      // A real cache hands out a fresh Response each time.
      match: async (key) => {
        const hit = store.get(name).get(key);
        return hit instanceof Response ? hit.clone() : hit;
      },
      put: async (key, response) => void store.get(name).set(key, response),
    };
  };
  const context = {
    self: {
      registration: { scope: SCOPE },
      addEventListener: (type, handler) => {
        handlers[type] = handler;
      },
      clients: {
        claim: async () => void calls.claim++,
        matchAll: async (options) => {
          calls.matchAll = options;
          return Array.from({ length: windows });
        },
      },
      skipWaiting: () => void calls.skipWaiting++,
    },
    caches: { open, keys: async () => [...store.keys()], delete: async (name) => store.delete(name) },
    fetch: async (request) => {
      calls.fetched.push(request.url);
      return `network ${request.url}`;
    },
    Request,
    Response,
    URL,
  };
  runInNewContext(code, context);
  const cacheName = `ddalab:${SCOPE}:${/^const BUILD = \{"version":"(\w+)"/m.exec(code)?.[1]}`;
  return { handlers, calls, store, cacheName };
}

/** What the worker answers for a request: the response, or "passed" when it did not call respondWith. */
async function answer(worker, { url, method = "GET", mode = "no-cors", range = false }) {
  const headers = new Headers(range ? { Range: "bytes=0-9" } : {});
  let responded;
  worker.handlers.fetch({ request: { url, method, mode, headers }, respondWith: (p) => (responded = p) });
  return responded ? await responded : "passed";
}

test("install_keeps_every_file_of_the_build_past_the_http_cache_and_waits", async () => {
  const worker = start();
  let waited;
  worker.handlers.install({ waitUntil: (p) => (waited = p) });
  await waited;
  expect(worker.calls.installed).toEqual(build.files.map((file) => [`${SCOPE}${file}`, "reload"]));
  expect(worker.calls.skipWaiting).toBe(0);
  expect([...worker.store.keys()]).toEqual([worker.cacheName]);
});

test.each([
  ["the_folder", { url: SCOPE, mode: "navigate" }, `cached ${SCOPE}index.html`],
  ["index_html", { url: `${SCOPE}index.html`, mode: "navigate" }, `cached ${SCOPE}index.html`],
  [
    "a_deep_link",
    { url: `${SCOPE}?openneuro=ds003029&tag=1.0.7`, mode: "navigate" },
    `cached ${SCOPE}index.html`,
  ],
  ["a_listed_script", { url: `${SCOPE}assets/app-1.js` }, `cached ${SCOPE}assets/app-1.js`],
  ["a_listed_wasm_module", { url: `${SCOPE}assets/engine.wasm` }, `cached ${SCOPE}assets/engine.wasm`],
  ["the_manifest", { url: `${SCOPE}manifest.webmanifest` }, `cached ${SCOPE}manifest.webmanifest`],
  ["a_page_of_the_site_outside_the_app", { url: `${SCOPE}docs/`, mode: "navigate" }, "passed"],
  // A file of the scope that is not in the build and in no older cache: the network answers.
  ["an_unlisted_file", { url: `${SCOPE}assets/other.js` }, `network ${SCOPE}assets/other.js`],
  ["the_worker_itself", { url: `${SCOPE}sw.js` }, `network ${SCOPE}sw.js`],
  ["openneuro", { url: "https://openneuro.org/crn/graphql" }, "passed"],
  ["a_listed_name_on_another_origin", { url: "https://s3.amazonaws.com/app/assets/app-1.js" }, "passed"],
  ["a_post", { url: `${SCOPE}assets/app-1.js`, method: "POST" }, "passed"],
  ["a_range_request", { url: `${SCOPE}assets/engine.wasm`, range: true }, "passed"],
  ["an_unlisted_range_request", { url: `${SCOPE}assets/old.wasm`, range: true }, "passed"],
  ["a_blob_url", { url: "blob:https://example.test/1c6a" }, "passed"],
  ["a_data_url", { url: "data:text/plain,hello" }, "passed"],
])("fetch_%s", async (_, request, expected) => {
  const worker = start();
  const kept = build.files.map((file) => [`${SCOPE}${file}`, `cached ${SCOPE}${file}`]);
  worker.store.set(worker.cacheName, new Map(kept));
  expect(await answer(worker, request)).toBe(expected);
});

test("a_listed_file_missing_from_the_cache_comes_from_the_network", async () => {
  const worker = start();
  const url = `${SCOPE}assets/app-1.js`;
  expect(await answer(worker, { url })).toBe(`network ${url}`);
  expect(worker.calls.fetched).toEqual([url]);
});

const MARKER = `ddalab-active:${SCOPE}`;
const cacheOf = (version) => `ddalab:${SCOPE}:${version}`;
const OTHER = "ddalab:https://example.test/other/:v1";

/**
 * A cache store holding the caches of the versions `older` of this scope (in the order they were created), one of
 * another scope and an unrelated one. `active` is the version the marker records: the last one that activated.
 */
const storeWith = (older, active) =>
  new Map([
    ...older.map((version) => [cacheOf(version), new Map()]),
    [OTHER, new Map()],
    ["unrelated", new Map()],
    ...(active ? [[MARKER, new Map([[`${SCOPE}.active`, new Response(cacheOf(active))]])]] : []),
  ]);
const markedActive = (store) => store.get(MARKER).get(`${SCOPE}.active`).clone().text();

async function activate(worker) {
  let waited;
  worker.handlers.activate({ waitUntil: (p) => (waited = p) });
  await waited;
}

test("activate_deletes_every_older_build_of_its_scope_when_no_window_is_open", async () => {
  const store = storeWith(["old", "older"], "older");
  const worker = start(store, 0);
  store.set(worker.cacheName, new Map());
  await activate(worker);
  expect([...store.keys()].sort()).toEqual([MARKER, worker.cacheName, OTHER, "unrelated"].sort());
  expect(worker.calls.claim).toBe(1);
  expect(worker.calls.matchAll).toEqual({ type: "window", includeUncontrolled: true });
  expect(await markedActive(store)).toBe(worker.cacheName);
});

test("an_activation_cut_short_during_the_deletes_has_recorded_itself_already", async () => {
  const store = storeWith(["old", "older"], "old");
  const worker = start(store, 0);
  store.set(worker.cacheName, new Map());
  store.delete = () => {
    throw new Error("cut short");
  };
  await expect(activate(worker)).rejects.toThrow("cut short");
  expect(await markedActive(store)).toBe(worker.cacheName);
});

test("a_first_activation_with_no_marker_keeps_nothing_and_records_itself", async () => {
  const store = storeWith(["old"]);
  const worker = start(store, 1);
  store.set(worker.cacheName, new Map());
  await activate(worker);
  expect([...store.keys()].sort()).toEqual([MARKER, worker.cacheName, OTHER, "unrelated"].sort());
  expect(await markedActive(store)).toBe(worker.cacheName);
});

test("activate_keeps_the_active_build_while_a_window_is_open_and_nothing_else", async () => {
  // The caches in the order they were created: the active one is not the newest.
  const store = storeWith(["oldest", "active", "newer"], "active");
  const worker = start(store, 2);
  store.set(worker.cacheName, new Map());
  await activate(worker);
  expect([...store.keys()].sort()).toEqual(
    [MARKER, worker.cacheName, cacheOf("active"), OTHER, "unrelated"].sort(),
  );
  expect(worker.calls.claim).toBe(1);
  expect(await markedActive(store)).toBe(worker.cacheName);
});

// A active in two windows, B installed and waits, C replaces B, and one window presses Reload: C activates. The other
// window is still on A's page and asks for A's chunks, which A's cache alone holds.
test("a_window_on_a_stays_served_when_c_activates_with_b_never_activated", async () => {
  const a = cacheOf("A");
  const store = storeWith(["A", "B"], "A");
  store.get(a).set(`${SCOPE}assets/a-only.js`, "A's chunk");
  const worker = start(store, 2); // the worker of C
  store.set(worker.cacheName, new Map(build.files.map((file) => [`${SCOPE}${file}`, `cached ${file}`])));
  await activate(worker);
  expect([...store.keys()].sort()).toEqual([MARKER, a, worker.cacheName, OTHER, "unrelated"].sort());
  expect(await answer(worker, { url: `${SCOPE}assets/a-only.js` })).toBe("A's chunk");
  expect(await markedActive(store)).toBe(worker.cacheName);

  // The next version, D, activates with a window still open: C stays, A goes. At most two builds are stored.
  const later = start(store, 1, variant());
  store.set(later.cacheName, new Map());
  await activate(later);
  expect([...store.keys()].sort()).toEqual(
    [MARKER, worker.cacheName, later.cacheName, OTHER, "unrelated"].sort(),
  );
  expect(await markedActive(store)).toBe(later.cacheName);
  expect(later.cacheName).not.toBe(worker.cacheName);
});

test("a_window_on_the_previous_build_gets_its_files_that_left_this_one", async () => {
  const store = storeWith(["older", "previous"]);
  store.get(`ddalab:${SCOPE}:older`).set(`${SCOPE}assets/gone.js`, "older gone.js");
  store.get(`ddalab:${SCOPE}:older`).set(`${SCOPE}assets/both.js`, "older both.js");
  store.get(`ddalab:${SCOPE}:previous`).set(`${SCOPE}assets/both.js`, "previous both.js");
  const worker = start(store);
  const current = build.files.map((file) => [`${SCOPE}${file}`, `cached ${SCOPE}${file}`]);
  store.set(worker.cacheName, new Map(current));
  expect(await answer(worker, { url: `${SCOPE}assets/gone.js` })).toBe("older gone.js");
  // The newest older cache answers first, and this build's own cache before any of them.
  expect(await answer(worker, { url: `${SCOPE}assets/both.js` })).toBe("previous both.js");
  expect(await answer(worker, { url: `${SCOPE}assets/app-1.js` })).toBe(`cached ${SCOPE}assets/app-1.js`);
  // What no cache holds, and anything of another scope's caches, goes to the network.
  expect(await answer(worker, { url: `${SCOPE}assets/never.js` })).toBe(`network ${SCOPE}assets/never.js`);
  expect(worker.calls.fetched).toEqual([`${SCOPE}assets/never.js`]);
});

test("only_the_page_can_make_it_skip_waiting", () => {
  const worker = start();
  worker.handlers.message({ data: "something else" });
  expect(worker.calls.skipWaiting).toBe(0);
  worker.handlers.message({ data: "skipWaiting" });
  expect(worker.calls.skipWaiting).toBe(1);
});
