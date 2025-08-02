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
  // In Next.js 14, serverExternalPackages is in experimental
  experimental: {
    serverComponentsExternalPackages: ["pino"],
  },
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

    // Fix createClientModuleProxy issue with a custom webpack plugin
    // TEMPORARILY COMMENTED OUT TO TEST BUILD
    // if (isServer) {
    //   config.plugins.push({
    //     apply: (compiler) => {
    //       compiler.hooks.compilation.tap('CreateClientModuleProxyFix', (compilation) => {
    //         compilation.hooks.processAssets.tap(
    //           {
    //             name: 'CreateClientModuleProxyFix',
    //             stage: compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
    //           },
    //           (assets) => {
    //             Object.keys(assets).forEach((filename) => {
    //               if (filename.endsWith('.js')) {
    //                 const asset = assets[filename];
    //                 let source = asset.source();
                    
    //                 if (typeof source === 'string' && source.includes('createClientModuleProxy')) {
    //                   // Add createClientModuleProxy polyfill at the top
    //                   const polyfill = `
    // if (typeof createClientModuleProxy === 'undefined') {
    //   var createClientModuleProxy = function(moduleId) {
    //     return { __esModule: true, default: function() { return null; } };
    //   };
    // }
    // `;
                      
    //                   // Replace problematic patterns
    //                   source = source.replace(
    //                     /(\w+)\.createClientModuleProxy\s*\(/g,
    //                     '(($1 && $1.createClientModuleProxy) || createClientModuleProxy)('
    //                   );
                      
    //                   const newSource = polyfill + source;
                      
    //                   compilation.updateAsset(filename, {
    //                     source: () => newSource,
    //                     size: () => newSource.length
    //                   });
    //                 }
    //               }
    //             });
    //           }
    //         );
    //       });
    //     }
    //   });
    // }

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
