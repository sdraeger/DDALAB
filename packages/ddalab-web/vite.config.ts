import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
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
  worker: { format: "es" },
  // The perf tests measure memory with performance.measureUserAgentSpecificMemory, which needs isolation.
  server: process.env.DDALAB_ISOLATE
    ? {
        headers: {
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
        },
      }
    : {},
});
