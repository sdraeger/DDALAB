import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error The policy reader is plain JavaScript without declarations.
import { cspOf } from "./scripts/policy.mjs";
// @ts-expect-error The service worker's build step is plain JavaScript without declarations.
import { bakeServiceWorker } from "./scripts/precache.mjs";

/** Production builds only: not the dev server, and not `vite build --mode e2e`, whose app registers no worker. */
const production: Plugin["apply"] = (config, { command }) =>
  command === "build" && config.mode === "production";

let outDir = "";

// The perf tests (dev server) and the benchmark (`vite preview`) measure memory with
// performance.measureUserAgentSpecificMemory, which needs cross-origin isolation. Only they set DDALAB_ISOLATE; the
// shipped headers live in public/.htaccess.
const isolated = process.env.DDALAB_ISOLATE
  ? {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    }
  : {};

export default defineConfig({
  // Relative URLs: dist works from any path (a userdir such as /~name/ddalab/) without a rebuild.
  base: "./",
  plugins: [
    react(),
    {
      // GitHub Pages cannot send headers and ignores .htaccess, so the production page carries the policy of
      // public/.htaccess, the one source, as a <meta> too. A meta policy cannot hold frame-ancestors (nor report-uri or
      // sandbox), so keep those out of that line, and it does not govern worker scripts: a worker runs under the
      // headers of its own response, which on Pages hold no policy. First in <head>, since it covers only what follows.
      name: "csp-meta",
      apply: production,
      transformIndexHtml: () => [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: cspOf(readFileSync(new URL("./public/.htaccess", import.meta.url), "utf8")),
          },
          injectTo: "head-prepend",
        },
      ],
    },
    {
      // The service worker (public/sw.js) keeps every file of the build: bake its list and version into dist/sw.js once
      // all the files are in dist.
      name: "service-worker",
      apply: production,
      configResolved: (config) => {
        outDir = resolve(config.root, config.build.outDir);
      },
      closeBundle: () => bakeServiceWorker(outDir),
    },
    {
      // The entry applies the stored theme before React renders; holding the first paint for it (in browsers that
      // support `blocking`) keeps a dark pick from opening on a light frame.
      name: "render-blocking-entry",
      transformIndexHtml: {
        order: "post",
        handler: (html) =>
          html.replace(/<script type="module"(?! blocking)/g, '<script type="module" blocking="render"'),
      },
    },
  ],
  // Minified builds drop legal comments (`/*!`, `@license`) unless asked: the color maps' MIT notice must stay.
  build: { rolldownOptions: { output: { comments: { legal: true } } } },
  worker: { format: "es" },
  server: isolated,
  preview: isolated,
});
