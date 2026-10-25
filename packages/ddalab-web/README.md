# ddalab-web

The DDALAB web app: React and TypeScript on Vite. The engine, `packages/dda-rs`, runs as WebAssembly in Web Workers. Recordings stay on the user's machine.

Needs Node 26 and Rust stable with the `wasm32-unknown-unknown` target.

```sh
npm ci
npm run dev           # builds the wasm core, serves the app at http://localhost:5173
npm run check         # Biome
npm test              # unit tests
npm run test:e2e      # Playwright on Chromium, Firefox and WebKit; builds the native CLI it compares with
npm run build         # wasm, type check, vite build, then the dist and bundle size checks
npm run test:dist     # smoke test of dist/ under a path with its CSP (run `npm run build` first)
```

`npm run build` writes `dist/`. Its checks fail the build when `dist/` holds a test hook, or when the JavaScript the entry page loads exceeds 200 kB gzipped. The engine's wasm module (about 1.1 MB, 0.36 MB gzipped) loads in the workers. It has no limit; the build prints its size.

## Self-hosting

`dist/` is static files with relative URLs. Copy it to any static host, at the root or under a path, and open `index.html`. The app needs no server code, no COOP/COEP headers and no cross-origin isolation.

The host should send `application/wasm` for `.wasm` files. Without it the workers compile the module from its bytes instead of streaming it, and the app still runs.

### userdir web space

The userdir site is `https://example.org/ddalab`, which Apache serves from `~/public_html/ddalab` on the cluster's shared home. `dist/.htaccess` (from `public/.htaccess`) sets the MIME type and compression for `.wasm`, the Content-Security-Policy, immutable caching for the hashed assets and no caching for `index.html`. It replaces the server's own `Expires` and `Cache-Control` defaults. Each response then carries one `Cache-Control`.

The folder needs `AllowOverride FileInfo` (or `All`). With `AllowOverride None` Apache ignores the file and the app runs without the headers. With any other value that lacks `FileInfo`, Apache answers 500 for the whole folder.

```sh
npm run deploy:userdir                # builds, runs the checks, lists what rsync would change on compute-host
npm run deploy:userdir -- --publish   # copies dist/ to compute-host:public_html/ddalab/, then checks the headers the host sends
npm run check:live                # the header check alone, against the site
```

A publish copies everything except `index.html` first, then `index.html` with `--delete-delay`, which removes older files last. `--publish` refuses a target that is not empty and lacks the `.ddalab-web` marker (the build writes it into `dist/`), unless `--replace` is also given. The header check sends HEAD requests for the folder, `index.html`, the entry script, a style sheet and the wasm module, and exits non-zero when one gets no answer or lacks the MIME type, the single `Cache-Control` or the CSP of `public/.htaccess`.

### Content-Security-Policy

The policy lives in one place, `public/.htaccess`. Its `connect-src` line lists the hosts the app may fetch from (`'self'`, OpenNeuro's API and its S3 file host). When the app reaches a new host, add it there. A host that serves `dist/` another way sets the same policy in its own configuration. `npm run test:dist` serves `dist/` with the policy read from `dist/.htaccess` and fails on any violation.

Base UI adds an inline `<style>` to some components, which `style-src 'self'` blocks. `src/main.tsx` wraps the app in `CSPProvider` with `disableStyleElements` for that reason.

## CI

`.github/workflows/web.yml` runs on pull requests and pushes to `main` that touch the web packages, and on `v*` tags: Biome, unit tests, Playwright on the three browsers, the production build with its checks, and `npm run test:dist` twice (once with the wasm module served as `application/wasm`, once as `application/octet-stream` to exercise the loader's fallback). A `v*` tag also attaches `ddalab-web-<version>.zip` (the contents of `dist/`) to the GitHub release.
