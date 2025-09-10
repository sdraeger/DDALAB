/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: require('path').join(__dirname, '../../'),
  transpilePackages: ['shared'],
  
  // Fix WebSocket connection for development
  ...(process.env.NODE_ENV === 'development' && {
    async rewrites() {
      return [
        // Proxy API calls to backend
        {
          source: '/api-backend/:path*',
          destination: 'http://localhost:8001/api/:path*'
        }
      ];
    },
  }),

  webpack: (config, { dev, isServer }) => {
    // Handle WebGL and Three.js
    config.resolve.alias = {
      ...config.resolve.alias,
      'three/examples/jsm': 'three/examples/jsm',
    };
    
    return config;
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig