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
  // Remove assetPrefix for now - causes font loading issues
  // assetPrefix: '.',
}

module.exports = nextConfig
