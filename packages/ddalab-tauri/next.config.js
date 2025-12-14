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

  // Turbopack configuration (Next.js 16+)
  turbopack: {},

  // Webpack configuration for WASM support (used when --webpack flag is passed)
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };

      // Optimize chunking for visualization libraries
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

    return config;
  },
};

module.exports = nextConfig;
