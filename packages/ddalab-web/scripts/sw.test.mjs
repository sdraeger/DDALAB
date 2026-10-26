// public/sw.js, baked for a small build, run against stub worker globals: what it keeps, what it answers, what it
// leaves to the network, and what it deletes when it activates.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { bakeServiceWorker, precacheOf } from "./precache.mjs";

const SCOPE = "https://example.test/app/";
let dir;
let build;
let source;
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
function start(store = new Map(), windows = 0) {
  const handlers = {};
  const calls = { claim: 0, skipWaiting: 0, fetched: [], installed: [] };
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return {
      addAll: async (requests) => {
        calls.installed.push(...requests.map((r) => [r.url, r.cache]));
        for (const r of requests) store.get(name).set(r.url, `cached ${r.url}`);
      },
      match: async (key) => store.get(name).get(key),
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
    URL,
  };
  runInNewContext(source, context);
  const cacheName = `ddalab:${SCOPE}:${build.version}`;
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
  // A file of the scope that is not in the build: no older cache holds it, so the network answers.
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

/** A cache store holding `older` caches of this scope (oldest first), one of another scope and an unrelated one. */
const storeWith = (...older) =>
  new Map(
    [...older.map((v) => `ddalab:${SCOPE}:${v}`), "ddalab:https://example.test/other/:v1", "unrelated"].map(
      (name) => [name, new Map()],
    ),
  );

async function activate(worker) {
  let waited;
  worker.handlers.activate({ waitUntil: (p) => (waited = p) });
  await waited;
}

test("activate_deletes_every_older_build_of_its_scope_when_no_window_is_open", async () => {
  const store = storeWith("old", "older");
  const worker = start(store, 0);
  store.set(worker.cacheName, new Map());
  await activate(worker);
  expect([...store.keys()].sort()).toEqual(
    [worker.cacheName, "ddalab:https://example.test/other/:v1", "unrelated"].sort(),
  );
  expect(worker.calls.claim).toBe(1);
  expect(worker.calls.matchAll).toEqual({ type: "window", includeUncontrolled: true });
});

test("activate_keeps_the_previous_build_while_a_window_may_still_be_on_it", async () => {
  const store = storeWith("oldest", "older", "previous");
  const worker = start(store, 2);
  store.set(worker.cacheName, new Map());
  await activate(worker);
  expect([...store.keys()].sort()).toEqual(
    [
      worker.cacheName,
      `ddalab:${SCOPE}:previous`,
      "ddalab:https://example.test/other/:v1",
      "unrelated",
    ].sort(),
  );
  expect(worker.calls.claim).toBe(1);
});

test("a_window_on_the_previous_build_gets_its_files_that_left_this_one", async () => {
  const store = storeWith("older", "previous");
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
