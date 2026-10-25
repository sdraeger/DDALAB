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
npm run test:dist     # smoke test of dist/ on a static server under a path (run `npm run build` first)
```

`npm run build` writes `dist/`. Its checks fail the build when `dist/` holds a test hook, or when the JavaScript the entry page loads exceeds 200 kB gzipped. The engine's wasm module (about 1.1 MB, 0.36 MB gzipped) loads in the workers and is reported, not limited.

## Self-hosting

`dist/` is static files with relative URLs. Copy it to any static host, at the root or under a path, and open `index.html`. The app needs no server code, no COOP/COEP headers and no cross-origin isolation.

The host should send `application/wasm` for `.wasm` files. If it does not, the workers compile the module from its bytes instead of streaming it, and the app still runs.

### SNL web space

The SNL site is `https://snl.salk.edu/~sfdraeger/ddalab`, which Apache serves from `~/public_html/ddalab` on the cluster's shared home. `dist/.htaccess` (from `public/.htaccess`) sets the MIME type for `.wasm`, the Content-Security-Policy, immutable caching for the hashed assets and no caching for `index.html`. It needs `AllowOverride FileInfo` on the userdir; if the host ignores it, the app runs without the headers.

```sh
npm run deploy:snl                # builds, runs the checks, lists what rsync would change on node32
npm run deploy:snl -- --publish   # copies dist/ to node32:public_html/ddalab/ (--delete: removes older files)
```

`--publish` refuses a target that holds another site (a directory without an `assets/` folder) unless `--replace` is also given.

### Content-Security-Policy

The policy lives in one place, `public/.htaccess`. Its `connect-src` line lists the hosts the app may fetch from (`'self'`, OpenNeuro's API and its S3 file host). When the app reaches a new host, add it there. A host that serves `dist/` another way sets the same policy in its own configuration.

## CI

`.github/workflows/web.yml` runs on pull requests that touch the web packages, on `main` and on `v*` tags: Biome, unit tests, Playwright on the three browsers, the production build with its checks and `npm run test:dist`. A `v*` tag also attaches `ddalab-web-<version>.zip` (the contents of `dist/`) to the GitHub release.
