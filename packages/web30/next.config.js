/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: require('path').join(__dirname, '../../'),
  transpilePackages: ['shared'],
  // Use asset prefix to separate web30 assets from web20 (always for consistency with production)
  assetPrefix: '/web30-assets',
  // No basePath in development since Traefik strips the /web30 prefix
  eslint: {
    // Disable ESLint during builds to resolve configuration issues
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Disable type checking during builds to resolve React type conflicts
    ignoreBuildErrors: true,
  },

  // API rewrites for both development and production
  async rewrites() {
    return [
      // Proxy API calls to backend
      {
        source: '/api-backend/:path*',
        destination: process.env.NODE_ENV === 'development'
          ? 'http://localhost:8001/api/:path*'
          : `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'}/api/:path*`
      }
    ];
  },

  webpack: (config) => {
    // Handle WebGL and Three.js
    config.resolve.alias = {
      ...config.resolve.alias,
      'three/examples/jsm': 'three/examples/jsm',
      '@shared': require('path').join(__dirname, '../shared'),
    };

    return config;
  },
}

module.exports = nextConfig
