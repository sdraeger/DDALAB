import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// @ts-expect-error The policy reader is plain JavaScript without declarations.
import { cspOf } from "./scripts/policy.mjs";

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
      apply: (config, { command }) => command === "build" && config.mode === "production",
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
