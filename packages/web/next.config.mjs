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
      // Rewrites for GraphQL API
      {
        source: "/graphql",
        destination: "http://localhost:8001/graphql",
      },
      // Rewrites for API server
      {
        source: "/api/direct/:path*",
        destination: "http://localhost:8001/api/:path*",
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
    
    // Properly handle Apollo Client on the client side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    // Increase the asset size limit to handle large bundles like Apollo Client
    config.performance = {
      ...config.performance,
      maxAssetSize: 1000000, // 1MB
      maxEntrypointSize: 1000000, // 1MB
    };
    
    return config;
  },
};

export default nextConfig;
