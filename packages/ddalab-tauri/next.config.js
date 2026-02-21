const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only use static export for production builds
  ...(process.env.NODE_ENV === "production" && {
    output: "export",
    distDir: "out",
  }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  async headers() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }
    const noStoreHeaders = [
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
    ];
    return [
      {
        source: "/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/_next/:path*",
        headers: noStoreHeaders,
      },
    ];
  },

  // Turbopack configuration (Next.js 16+)
  turbopack: {
    // Use workspace root so hoisted node_modules (including next) are resolvable in turbo mode.
    root: path.resolve(__dirname, "..", ".."),
  },

  // Webpack configuration for WASM support (used when --webpack flag is passed)
  webpack: (config, { isServer, dev }) => {
    // Use non-eval source maps in dev client builds.
    // This avoids intermittent WebView parse failures on first startup
    // ("Unexpected EOF" in eval-wrapped layout chunks).
    if (dev && !isServer) {
      // Disable client source maps entirely in desktop dev mode to reduce
      // chunk size and avoid intermittent truncated layout chunk parsing.
      config.devtool = false;
      // Disable webpack filesystem cache in dev to avoid stale/corrupt
      // chunk artifacts across repeated Tauri restarts.
      config.cache = false;
      // Increase chunk load timeout to reduce false timeouts during heavy startup compiles.
      config.output = {
        ...config.output,
        chunkLoadTimeout: 240000,
      };
    }

    // wasm-bindgen wrappers (ddalab-wasm/pkg/*.js) expect .wasm as a URL asset.
    // Treating .wasm as "webassembly/async" makes webpack parse internal import
    // namespaces like "wbg" as modules, causing module resolution failures.
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };

      // Keep custom splitChunks for production only.
      // In dev, Next's default chunk strategy is more stable with HMR.
      if (!dev) {
        config.optimization = {
          ...config.optimization,
          splitChunks: {
            ...config.optimization.splitChunks,
            cacheGroups: {
              ...config.optimization.splitChunks?.cacheGroups,
              // Split uPlot into separate chunk (heavy visualization library)
              uplot: {
                test: /[\\/]node_modules[\\/]uplot[\\/]/,
                name: "uplot",
                chunks: "all",
                priority: 30,
              },
              // Split ECharts into separate chunk (heavy visualization library)
              echarts: {
                test: /[\\/]node_modules[\\/]echarts[\\/]/,
                name: "echarts",
                chunks: "all",
                priority: 30,
              },
            },
          },
        };
      }
    }

    return config;
  },
};

module.exports = nextConfig;
