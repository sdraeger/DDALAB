/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only use static export for production builds
  ...(process.env.NODE_ENV === 'production' && {
    output: 'export',
    distDir: 'out',
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
  // Remove assetPrefix for now - causes font loading issues
  // assetPrefix: '.',
}

module.exports = nextConfig
