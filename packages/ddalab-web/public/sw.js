// The service worker of the DDALAB web app: it keeps the build's own files so the app starts offline.
// - Install: fetches every file of the build (BUILD.files) past the HTTP cache into a cache named for this scope and the
//   build's version.
// - Fetch: answers the page itself (the folder or index.html, whatever the query) and the build's own files from that
//   cache. Other origins (OpenNeuro, S3), Range and non-GET requests, other pages and the user's files (the origin's
//   private file system, blob: and data: URLs) never get an answer from it. A same-scope file that is not in this build
//   is looked for in the cache of the previous version, then fetched: a window that started on that version still asks
//   for its lazy chunks and workers. Nothing is added to a cache while the app runs.
// - A new version waits until the page asks for it with the message "skipWaiting" (src/app/update.ts), and takes over
//   the open pages once it activates. Activating deletes the caches of older versions of this scope, except the
//   previous one while a window is open: that window may not have reloaded yet.
// scripts/precache.mjs replaces the next line at build time with the version and the files of the build.
const BUILD = { version: "dev", files: [] };

const scope = self.registration.scope;
const prefix = `ddalab:${scope}:`;
const cacheName = prefix + BUILD.version;
const urlOf = (file) => new URL(file, scope).href;
const listed = new Set(BUILD.files.map(urlOf));
const page = urlOf("index.html");

/** The cache key of what `request` asks for when this build's cache answers it; undefined otherwise. */
function keyOf(request) {
  if (request.method !== "GET" || request.headers.has("range")) return undefined;
  if (request.mode !== "navigate") return listed.has(request.url) ? request.url : undefined;
  const url = new URL(request.url);
  url.search = "";
  return url.href === scope || url.href === page ? page : undefined;
}

/** Whether `request` is a plain GET for a file under the scope that this build does not list. */
const unlisted = (request) =>
  request.method === "GET" &&
  request.mode !== "navigate" &&
  !request.headers.has("range") &&
  request.url.startsWith(scope);

/** The names of the caches of older versions of this scope, oldest first. */
const olderCaches = async () =>
  (await caches.keys()).filter((name) => name.startsWith(prefix) && name !== cacheName);

/** What the caches of older versions hold for `request`, the newest first. */
async function previous(request) {
  for (const name of (await olderCaches()).reverse()) {
    const hit = await (await caches.open(name)).match(request.url);
    if (hit) return hit;
  }
  return undefined;
}

self.addEventListener("install", (event) => {
  const requests = BUILD.files.map((file) => new Request(urlOf(file), { cache: "reload" }));
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(requests)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const older = await olderCaches();
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const kept = windows.length > 0 ? older.slice(-1) : [];
      await Promise.all(older.filter((name) => !kept.includes(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const key = keyOf(request);
  if (key !== undefined) {
    event.respondWith(
      caches
        .open(cacheName)
        .then((cache) => cache.match(key))
        .then((hit) => hit ?? fetch(request)),
    );
  } else if (unlisted(request)) {
    event.respondWith(previous(request).then((hit) => hit ?? fetch(request)));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
