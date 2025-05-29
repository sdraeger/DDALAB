import esbuild from 'esbuild';
import cpx from 'cpx';

const rendererConfig = {
  entryPoints: ['src/renderer.tsx'],
  bundle: true,
  outfile: 'dist/src/renderer.bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
  external: ['electron'],
  loader: {
    '.js': 'jsx',
    '.ts': 'ts',
    '.tsx': 'tsx',
  },
  define: {
    'process.env.NODE_ENV': '"development"',
  },
};

const mainConfig = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  loader: {
    '.ts': 'ts',
  },
};

const preloadConfig = {
  entryPoints: ['preload.ts'],
  bundle: true,
  outfile: 'dist/preload.js',
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['electron'],
  loader: {
    '.ts': 'ts',
  },
};

async function build() {
  try {
    // Build main, renderer, and preload processes
    await esbuild.build(mainConfig);
    console.log('Main process build successful with esbuild!');

    await esbuild.build(rendererConfig);
    console.log('Renderer build successful with esbuild!');

    await esbuild.build(preloadConfig);
    console.log('Preload script build successful with esbuild!');
  } catch (error) {
    console.error('esbuild failed:', error);
    process.exit(1);
  }
}

// Copy static assets
async function copyStaticAssets() {
  try {
    await cpx.copy("src/installer.html", "dist/src");
    await cpx.copy("src/style.css", "dist/src");
    await cpx.copy(".env.example", "dist"); // Copy .env.example to dist/
    console.log("Static assets copied successfully.");
  } catch (error) {
    console.error("Failed to copy static assets:", error);
    process.exit(1);
  }
}

async function buildAll() {
  await build();
  await copyStaticAssets();
}

buildAll();
