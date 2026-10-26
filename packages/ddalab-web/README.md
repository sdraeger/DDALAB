# ddalab-web

The DDALAB web app: React and TypeScript on Vite. The engine, `packages/dda-rs`, runs as WebAssembly in Web Workers. Recordings stay on the user's machine. The app is at <https://sdraeger.github.io/DDALAB/>.

Needs Node 26 and Rust stable with the `wasm32-unknown-unknown` target.

```sh
npm ci
npm run dev           # builds the wasm core, serves the app at http://localhost:5173
npm run check         # Biome
npm test              # unit tests
npm run test:e2e      # Playwright on Chromium, Firefox and WebKit; builds the native CLI it compares with
npm run build         # wasm, type check, vite build, then the dist and bundle size checks
npm run test:dist     # smoke and install tests of dist/ under /~user/ddalab/ and /DDALAB/ with its CSP (run `npm run build` first)
```

`npm run build` writes `dist/`. Its checks fail the build when `dist/` holds a test hook, or when the JavaScript the entry page loads exceeds 200 kB gzipped. The engine's wasm module (about 1.1 MB, 0.36 MB gzipped) loads in the workers. It has no limit; the build prints its size.

## Self-hosting

`dist/` is static files with relative URLs. Copy it to any static host, at the root or under a path, and open `index.html`. The app needs no server code, no COOP/COEP headers and no cross-origin isolation.

The host should send `application/wasm` for `.wasm` files. Without it the workers compile the module from its bytes instead of streaming it, and the app still runs.

### GitHub Pages

The app is served from <https://sdraeger.github.io/DDALAB/>. Project paths are case-sensitive: `/ddalab/` is a 404. The `pages` job of `.github/workflows/web.yml` deploys the `dist/` that the web job built and tested, on every `v*` tag after the web and e2e jobs pass. A tag with a `-` (a pre-release) stays off the site, since every installed copy would offer it as an update. The repository's `github-pages` environment needs a deployment rule for `v*` tags; by default it allows only `main`.

The origin is `https://sdraeger.github.io`, which the user site `sdraeger/sdraeger.github.io` shares. DDALAB's browser storage (results, history, stored file handles and the worker's cache) is shared only with the pages under `sdraeger.github.io`, which are the owner's own. Keep that site free of third-party scripts and of a service worker at its root: such a worker would answer requests for `/DDALAB/` until DDALAB's own worker is installed.

Pages cannot send headers and ignores `.htaccess`. Its `index.html` carries the Content-Security-Policy as a `<meta>` element, which the build generates from `public/.htaccess`. A `<meta>` policy has two limits. It cannot carry `frame-ancestors` (the browser ignores that directive there), which leaves other sites free to frame the app. And it does not govern worker scripts: a worker runs under the headers of its own response, which on Pages hold no policy. The policy restricts the page and leaves the engine and IO workers alone. `worker-src` still limits which workers the page may start.

```sh
npm run check:pages                        # the deployed site: Content-Types (application/wasm) and the <meta> policy
npm run check:pages -- <site URL> [dist]   # another address, such as a fork's Pages site
```

The check skips what Pages decides itself (`Cache-Control`, `Expires`, the policy header) and says so. Pages caches for ten minutes. A check right after a deploy can still see the previous site.

### Install, offline use and updates

The app is installable and keeps itself for offline use. Chrome and Edge show an install icon in the address bar; Safari 17 on macOS 14 has File, Add to Dock; Firefox has no desktop install, and the plain address works there. The repository README has the steps per browser. The pieces:

- `public/manifest.webmanifest` names the app (`start_url` and `scope` are `./`, display `standalone`, colors from the light chrome token) and lists the icons, the file handlers and a launch handler. It has no `id`: the identity of an installed app is then its start URL, the folder the app is served from, on every host. An `id` of `./` would resolve to the root of the origin and be shared with every other app there. Browsers fix the identity at the first install. The icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) come from `public/favicon.svg` through `node scripts/make-icons.mjs`, which renders them in headless Chromium.
- `public/sw.js` is a hand-written service worker. The production build bakes into `dist/sw.js` the list of every file of the build (except hidden files and the worker) and a version, the hash of those files (`scripts/precache.mjs`). Installing fetches every listed file past the HTTP cache into a cache named for the scope and the version. The page itself (the folder, `index.html`, any query) and the listed files come from that cache first. Everything else goes to the network untouched: other origins (OpenNeuro, S3), Range requests, requests that are not GET and any URL that is not listed. Nothing is added to the cache while the app runs, and recordings and results never pass through it. A file of the scope that this build does not list comes from the cache of the previous version when that has it (a window that has not reloaded still asks for its lazy chunks and workers), else from the network. Activating deletes every cache of the scope but its own and the one of the version that was active until then, which stays while any window of the origin is open (a marker cache, `ddalab-active:<scope>`, records the active version). A version that installed and never activated, such as a waiting worker that a newer one replaced, leaves a cache that the next activation deletes. At most two builds are stored, the current one and the previous one, and the previous one stays until the next activation even after its last window has gone. Each build is about 1.9 MB, 1.1 MB of it the wasm module.
- The worker is registered from `src/main.tsx` in production builds only (`import.meta.env.MODE === "production"`), never in the dev server or the e2e build, and with the relative scope `./`: it works under `/DDALAB/`, under a userdir path and at a root. The `worker-src 'self'` and `default-src 'self'` rules of the policy already allow the worker and the manifest.
- A new version installs next to the running one and waits. `src/app/UpdateNotice.tsx` then shows "A new version of DDALAB is ready" with Reload, which asks the waiting worker to take over (`skipWaiting` by message) and reloads once on the change of controller. While a DDA run is in progress the notice says the version will be ready after the run, and Reload reloads when the run ends (after the run's record is saved). An update the user ignores takes over when every window of the app has closed.
- Several windows: when one window takes an update, the others stay on the old page under the new worker. They keep working from the previous version's cache, they show the notice again, and their Reload reloads at once. The manifest's `launch_handler` (`focus-existing`) sends a later file launch to the open window: no second window opens.
- Browsers look for a new `sw.js` when the app starts. A window that stays open has no start. The app asks once an hour while the window is visible (`src/app/update.ts`). Serve `sw.js` and `index.html` without long caching: `public/.htaccess` sets `no-cache` for both. Pages caches for ten minutes. An update can take that long to show.

Only Chromium is tested for the worker (`e2e-dist/pwa.spec.ts`: the manifest, the worker's control at the app's folder under both paths, offline reload with a recording opened, requests the cache must not answer, the update prompt with a changed build, two windows across an update, the hourly check on a fake clock, and Reload waiting for a run). Firefox and Safari run the same worker in a tab.

Two things work in Chromium only, and other browsers ignore them:

- Files opened from Finder or Explorer. The manifest's `file_handlers` accept `.edf`, `.bdf`, `.vhdr`, `.csv`, `.tsv` and `.txt` for the page `./`. `src/app/launch.ts` consumes `window.launchQueue` and opens the files as a picked file opens: the file handles go to the tab and the recording reattaches later. A `.vhdr` launched alone has no companions: the app shows the missing-companions message with its folder action, and when a folder of an open tab is readable already and holds the header, it takes the companions from there. `src/app/launch.test.ts` tests the consumer with stub handles and `e2e/launch.spec.ts` replaces the launch queue with one the test calls; neither starts a real launch from the file manager.
- The Save dialog. `src/app/download.ts` opens `showSaveFilePicker` first, with the file's name and type, then streams the bytes into the chosen file (the zip as a stream, the JSON and the CSV as blob streams). A closed dialog does nothing and shows no error. Without the dialog the file downloads as before. `e2e/save.spec.ts` stubs the dialog with a file of the origin private file system and checks its bytes against the download's.

### Hosting on an internal server

The release attaches `ddalab-web-<version>.zip`, the contents of `dist/`. Unzip it onto any static web server that uses HTTPS (or `localhost`): the app needs a secure context for the worker and for the origin private file system. Users open that address, and install, offline use and updates work as on Pages. To update, replace the files; installed copies show the update notice. Opening `index.html` from disk does not work, because browsers do not start workers from `file://` pages. A shared userdir host has the one-origin problem described below.

### userdir web space (optional)

The userdir site is `https://example.org/ddalab`, an optional self-hosting path.

> **Warning:** a shared userdir host serves every user's pages from one origin. Another page on `example.org` can read what the app stores in the browser (results, history, settings) and can rewrite the worker's cache, which replaces the app's code until the next version. Prefer Pages for real data: its origin is shared only with the owner's own pages.

Apache serves the site from `~/public_html/ddalab` on the cluster's shared home. `dist/.htaccess` (from `public/.htaccess`) sets the MIME type and compression for `.wasm`, the Content-Security-Policy, immutable caching for the hashed assets and no caching for `index.html`. It replaces the server's own `Expires` and `Cache-Control` defaults. Each response then carries one `Cache-Control`.

The folder needs `AllowOverride FileInfo` (or `All`). With `AllowOverride None` Apache ignores the file and the app runs without the headers. With any other value that lacks `FileInfo`, Apache answers 500 for the whole folder.

```sh
npm run deploy:userdir                # builds, runs the checks, lists what rsync would change on compute-host
npm run deploy:userdir -- --publish   # copies dist/ to compute-host:public_html/ddalab/, then checks the headers the host sends
npm run check:live                # the header check alone, against the site
```

A publish copies everything except `index.html` first, then `index.html` with `--delete-delay`, which removes older files last. `--publish` refuses a target that is not empty and lacks the `.ddalab-web` marker (the build writes it into `dist/`), unless `--replace` is also given. The header check sends HEAD requests for the folder, `index.html`, the entry script, a style sheet and the wasm module, and exits non-zero when one gets no answer or lacks the MIME type, the single `Cache-Control` or the CSP of `public/.htaccess`.

### Content-Security-Policy

The policy lives in one place, `public/.htaccess`. Its `connect-src` line lists the hosts the app may fetch from (`'self'`, OpenNeuro's API and its S3 file host). When the app reaches a new host, add it there. The production build copies the policy into `index.html` as a `<meta>` element (see GitHub Pages above for its limits). Keep `frame-ancestors`, `report-uri` and `sandbox`, which a `<meta>` policy ignores, out of that line. A host that serves `dist/` another way and can send headers sets the same policy in its own configuration. `npm run test:dist` serves `dist/` under `/~user/ddalab/` with the policy header read from `dist/.htaccess` and under `/DDALAB/` without a header, as Pages does. It fails on any violation, and on a `<meta>` policy that differs from the `.htaccess` one.

Base UI adds an inline `<style>` to some components, which `style-src 'self'` blocks. `src/main.tsx` wraps the app in `CSPProvider` with `disableStyleElements` for that reason.

## CI

`.github/workflows/web.yml` runs on pull requests and pushes to `main` that touch the web packages, and on `v*` tags. The web job runs Biome, the unit tests, the production build with its checks, and `npm run test:dist` twice (once with the wasm module served as `application/wasm`, once as `application/octet-stream` to exercise the loader's fallback). The e2e tests run as one job per browser (Chromium, Firefox, WebKit), each with its own wasm core and native CLI; a failed one uploads its Playwright report and traces as `playwright-<browser>` for seven days. A `v*` tag attaches `ddalab-web-<version>.zip` (the contents of `dist/`) to the GitHub release and, without a `-` in the tag, deploys that `dist/` to GitHub Pages, both once the web job and the three e2e jobs pass.
