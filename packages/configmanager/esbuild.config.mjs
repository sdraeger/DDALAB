import esbuild from "esbuild";
import cpx from "cpx";
import { spawn } from "child_process";

let electronProcess = null;

function startElectron() {
  if (electronProcess) {
    electronProcess.kill();
  }

  electronProcess = spawn("npx", ["electron", "."], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });

  electronProcess.on("close", (code) => {
    if (code !== null && code !== 0) {
      console.log(`Electron process exited with code ${code}`);
    }
  });
}

// Plugin to restart Electron when main process changes
const electronRestartPlugin = {
  name: "electron-restart",
  setup(build) {
    build.onEnd(() => {
      console.log("Main process changed, restarting Electron...");
      startElectron();
    });
  },
};

const rendererConfig = {
  entryPoints: ["src/renderer.tsx"],
  bundle: true,
  outfile: "dist/src/renderer.bundle.js",
  platform: "browser",
  format: "iife",
  sourcemap: true,
  external: ["electron"],
  loader: {
    ".js": "jsx",
    ".ts": "ts",
    ".tsx": "tsx",
  },
  define: {
    "process.env.NODE_ENV": '"development"',
  },
  plugins: [{
    name: 'node-modules-external',
    setup(build) {
      // Mark Node.js built-in modules as external to prevent bundling errors
      build.onResolve({ filter: /^(fs|path|os|crypto|stream|util|buffer|events|child_process)$/ }, args => {
        return { external: true };
      });
      
      // Redirect logger imports to the shim for browser environment
      build.onResolve({ filter: /\/utils\/logger$/ }, args => {
        if (args.path.endsWith('/utils/logger')) {
          return { path: args.path + '-shim.ts' };
        }
      });
    },
  }],
};

const mainConfig = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/main.js",
  platform: "node",
  format: "cjs",
  sourcemap: true,
  external: ["electron"],
  loader: {
    ".ts": "ts",
  },
};

const preloadConfig = {
  entryPoints: ["preload.ts"],
  bundle: true,
  outfile: "dist/preload.js",
  platform: "node",
  format: "cjs",
  sourcemap: true,
  external: ["electron"],
  loader: {
    ".ts": "ts",
  },
};

async function build() {
  try {
    // Build main, renderer, and preload processes
    await esbuild.build(mainConfig);
    console.log("Main process build successful with esbuild!");

    await esbuild.build(rendererConfig);
    console.log("Renderer build successful with esbuild!");

    await esbuild.build(preloadConfig);
    console.log("Preload script build successful with esbuild!");
  } catch (error) {
    console.error("esbuild failed:", error);
    process.exit(1);
  }
}

// Copy static assets
async function copyStaticAssets() {
  try {
    await cpx.copy("src/configmanager.html", "dist/src");
    await cpx.copy("src/style.css", "dist/src");
    await cpx.copy("src/vendor/**/*", "dist/src/vendor");
    await cpx.copy(".env.example", "dist"); // Copy .env.example to dist/
    await cpx.copy("resources/**/*", "dist/resources"); // Copy bundled DDALAB files
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

async function watch() {
  try {
    // Add restart plugin only to main config for watch mode
    const mainConfigWithRestart = {
      ...mainConfig,
      plugins: [electronRestartPlugin],
    };

    // Create esbuild contexts for watch mode
    const mainContext = await esbuild.context(mainConfigWithRestart);
    const rendererContext = await esbuild.context(rendererConfig);
    const preloadContext = await esbuild.context(preloadConfig);

    // Initial build
    await mainContext.rebuild();
    console.log("Main process build successful with esbuild!");

    await rendererContext.rebuild();
    console.log("Renderer build successful with esbuild!");

    await preloadContext.rebuild();
    console.log("Preload script build successful with esbuild!");

    await copyStaticAssets();

    // Start watching (only call watch() once per context)
    await mainContext.watch();
    await rendererContext.watch();
    await preloadContext.watch();

    // Start Electron after initial build
    startElectron();

    console.log("Watching for changes...");

    // Handle process termination
    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      if (electronProcess) {
        electronProcess.kill();
      }
      await mainContext.dispose();
      await rendererContext.dispose();
      await preloadContext.dispose();
      process.exit(0);
    });
  } catch (error) {
    console.error("Watch mode failed:", error);
    process.exit(1);
  }
}

// Check if --watch flag is passed
const isWatchMode = process.argv.includes("--watch");

if (isWatchMode) {
  watch();
} else {
  buildAll();
}
