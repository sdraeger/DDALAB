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
  eslint: {
    // Disable ESLint during build - we'll run it separately
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Skip type checking during build for faster builds
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  // Remove assetPrefix for now - causes font loading issues
  // assetPrefix: '.',

  // Enable WebAssembly support
  webpack: (config, { isServer }) => {
    // Enable async WebAssembly
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Fix for WASM file handling
    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    // Handle WASM in node_modules or local packages
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
