import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
