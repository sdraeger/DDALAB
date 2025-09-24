/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Remove assetPrefix for now - causes font loading issues
  // assetPrefix: '.',
  distDir: 'out',
}

module.exports = nextConfig