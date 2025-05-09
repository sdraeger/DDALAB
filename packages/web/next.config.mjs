import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Add custom headers to enable WebSockets
  async headers() {
    return [
      {
        source: "/_next/webpack-hmr",
        headers: [
          {
            key: "Connection",
            value: "Upgrade",
          },
          {
            key: "Upgrade",
            value: "websocket",
          },
        ],
      },
    ];
  },
  // Add rewrites to ensure API routes work correctly
  async rewrites() {
    return [
      // Rewrites for API server
      {
        source: "/api/direct/:path*",
        destination: "https://localhost:8001/api/:path*",
      },
    ];
  },
  serverExternalPackages: ["pino"],
  webpack: (config, { isServer }) => {
    // Add alias for shared package and @ paths
    config.resolve.alias = {
      ...config.resolve.alias,
      shared: path.resolve(__dirname, "../shared"),
      "@": path.resolve(__dirname, "./app"),
    };
    return config;
  },
};

export default nextConfig;
