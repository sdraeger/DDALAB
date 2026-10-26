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
function start(store = new Map()) {
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
      clients: { claim: async () => void calls.claim++ },
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

/** What the worker answers for a request: the response, or "network" when it did not call respondWith. */
async function answer(worker, { url, method = "GET", mode = "no-cors", range = false }) {
  const headers = new Headers(range ? { Range: "bytes=0-9" } : {});
  let responded;
  worker.handlers.fetch({ request: { url, method, mode, headers }, respondWith: (p) => (responded = p) });
  return responded ? await responded : "network";
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
  ["a_page_of_the_site_outside_the_app", { url: `${SCOPE}docs/`, mode: "navigate" }, "network"],
  ["an_unlisted_file", { url: `${SCOPE}assets/other.js` }, "network"],
  ["the_worker_itself", { url: `${SCOPE}sw.js` }, "network"],
  ["openneuro", { url: "https://openneuro.org/crn/graphql" }, "network"],
  ["a_listed_name_on_another_origin", { url: "https://s3.amazonaws.com/app/assets/app-1.js" }, "network"],
  ["a_post", { url: `${SCOPE}assets/app-1.js`, method: "POST" }, "network"],
  ["a_range_request", { url: `${SCOPE}assets/engine.wasm`, range: true }, "network"],
  ["a_blob_url", { url: "blob:https://example.test/1c6a" }, "network"],
  ["a_data_url", { url: "data:text/plain,hello" }, "network"],
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

test("activate_deletes_the_older_builds_of_its_scope_only_and_takes_over", async () => {
  const store = new Map(
    [
      `ddalab:${SCOPE}:old`,
      `ddalab:${SCOPE}:older`,
      "ddalab:https://example.test/other/:v1",
      "unrelated",
    ].map((name) => [name, new Map()]),
  );
  const worker = start(store);
  store.set(worker.cacheName, new Map());
  let waited;
  worker.handlers.activate({ waitUntil: (p) => (waited = p) });
  await waited;
  expect([...store.keys()].sort()).toEqual(
    [worker.cacheName, "ddalab:https://example.test/other/:v1", "unrelated"].sort(),
  );
  expect(worker.calls.claim).toBe(1);
});

test("only_the_page_can_make_it_skip_waiting", () => {
  const worker = start();
  worker.handlers.message({ data: "something else" });
  expect(worker.calls.skipWaiting).toBe(0);
  worker.handlers.message({ data: "skipWaiting" });
  expect(worker.calls.skipWaiting).toBe(1);
});
