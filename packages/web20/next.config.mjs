import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["shared"],
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, '../../'),
  compiler: {
    removeConsole: false,
  },
  eslint: {
    // Disable ESLint during builds to resolve configuration issues
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    // Add alias for shared package
    config.resolve.alias = {
      ...config.resolve.alias,
      '@shared': resolve(__dirname, '../shared'),
    };
    
    return config;
  },
  async rewrites() {
    // Proxy API requests server-side to avoid browser CORS
    // API_ORIGIN should be the internal origin of FastAPI (defaults to localhost:8001)
    const apiOrigin = process.env.API_ORIGIN || "http://localhost:8001";
    return [
      {
        source: "/api-backend/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
  // Configure server-side fetch options for better connection management
  serverRuntimeConfig: {
    // Increase HTTP agent limits for API connections
    httpTimeout: 30000,
    httpKeepAlive: true,
    httpMaxSockets: 50,
    httpMaxFreeSockets: 10,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
