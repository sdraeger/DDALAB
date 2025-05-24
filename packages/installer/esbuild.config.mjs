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
    'process.env.NODE_ENV': '"development"', // Or 'production' for prod builds
    // Add other environment variables if needed by your React code
  },
  // To handle CSS imports if you decide to import CSS directly into TSX/JSX
  // plugins: [
  //   // Add esbuild plugins here if needed, e.g., for CSS modules or SASS
  // ],
};

const mainConfig = {
  entryPoints: ['main.ts'],
  bundle: false,
  outfile: 'dist/main.js',
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  loader: {
    '.ts': 'ts',
  },
};

async function build() {
  try {
    // Build both main and renderer processes
    await esbuild.build(mainConfig);
    console.log('Main process build successful with esbuild!');

    await esbuild.build(rendererConfig);
    console.log('Renderer build successful with esbuild!');
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
