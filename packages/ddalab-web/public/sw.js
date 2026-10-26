// The service worker of the DDALAB web app: it keeps the build's own files so the app starts offline.
// - Install: fetches every file of the build (BUILD.files) past the HTTP cache into a cache named for this scope and the
//   build's version.
// - Fetch: answers the page itself (the folder or index.html, whatever the query) and the build's own files from that
//   cache. Everything else goes to the network untouched, with no respondWith: other origins (OpenNeuro, S3), Range
//   and non-GET requests, and any URL that is not in the list. Nothing is added to the cache while the app runs, and
//   the user's files (the origin's private file system, blob: and data: URLs) never reach a worker.
// - A new version waits until the page asks for it with the message "skipWaiting" (src/app/update.ts), and takes over
//   the open pages once it activates. Activating deletes the caches of older builds of this scope.
// scripts/precache.mjs replaces the next line at build time with the version and the files of the build.
const BUILD = { version: "dev", files: [] };

const scope = self.registration.scope;
const prefix = `ddalab:${scope}:`;
const cacheName = prefix + BUILD.version;
const urlOf = (file) => new URL(file, scope).href;
const listed = new Set(BUILD.files.map(urlOf));
const page = urlOf("index.html");

/** The cache key of what `request` asks for when the cache answers it; undefined when it goes to the network. */
function keyOf(request) {
  if (request.method !== "GET" || request.headers.has("range")) return undefined;
  if (request.mode !== "navigate") return listed.has(request.url) ? request.url : undefined;
  const url = new URL(request.url);
  url.search = "";
  return url.href === scope || url.href === page ? page : undefined;
}

self.addEventListener("install", (event) => {
  const requests = BUILD.files.map((file) => new Request(urlOf(file), { cache: "reload" }));
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(requests)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(prefix) && name !== cacheName)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const key = keyOf(event.request);
  if (key === undefined) return;
  event.respondWith(
    caches
      .open(cacheName)
      .then((cache) => cache.match(key))
      .then((hit) => hit ?? fetch(event.request)),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
