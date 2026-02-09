#!/usr/bin/env bun
/**
 * build-registry.ts
 *
 * Scans the plugins/ directory and rebuilds registry.json.
 * For each plugin version directory, reads manifest.json and computes
 * the SHA-256 hash of plugin.wasm.
 *
 * Usage: bun run packages/ddalab-registry/scripts/build-registry.ts [--base-url URL]
 */

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  permissions: string[];
  category: string;
  entryPoint: string;
  minDdalabVersion?: string | null;
}

interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  permissions: string[];
  artifactUrl: string;
  sha256: string;
  minDdalabVersion: string | null;
  publishedAt: string;
}

interface RegistryIndex {
  version: number;
  updatedAt: string;
  registryUrl: string | null;
  plugins: RegistryEntry[];
}

const REGISTRY_DIR = resolve(import.meta.dir, "..");
const PLUGINS_DIR = join(REGISTRY_DIR, "plugins");

function computeSha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function main() {
  // Parse --base-url flag
  const args = process.argv.slice(2);
  let baseUrl: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base-url" && args[i + 1]) {
      baseUrl = args[i + 1].replace(/\/$/, "");
      i++;
    }
  }

  if (!(await dirExists(PLUGINS_DIR))) {
    console.log("No plugins/ directory found. Creating empty registry.");
    const index: RegistryIndex = {
      version: 1,
      updatedAt: new Date().toISOString(),
      registryUrl: baseUrl,
      plugins: [],
    };
    await writeFile(
      join(REGISTRY_DIR, "registry.json"),
      JSON.stringify(index, null, 2) + "\n",
    );
    return;
  }

  const plugins: RegistryEntry[] = [];
  const pluginDirs = await readdir(PLUGINS_DIR);

  for (const pluginId of pluginDirs) {
    const pluginPath = join(PLUGINS_DIR, pluginId);
    if (!(await dirExists(pluginPath))) continue;

    const versions = await readdir(pluginPath);
    for (const version of versions) {
      const versionPath = join(pluginPath, version);
      if (!(await dirExists(versionPath))) continue;

      const manifestPath = join(versionPath, "manifest.json");
      const wasmPath = join(versionPath, "plugin.wasm");

      if (!(await fileExists(manifestPath))) {
        console.warn(`  Skipping ${pluginId}/${version}: no manifest.json`);
        continue;
      }

      const manifestRaw = await readFile(manifestPath, "utf-8");
      const manifest: PluginManifest = JSON.parse(manifestRaw);

      let sha256 =
        "0000000000000000000000000000000000000000000000000000000000000000";
      if (await fileExists(wasmPath)) {
        const wasmBytes = await readFile(wasmPath);
        sha256 = computeSha256(wasmBytes);
        console.log(`  ${pluginId}@${version}: SHA-256 = ${sha256}`);
      } else {
        console.warn(
          `  ${pluginId}/${version}: no plugin.wasm (placeholder hash)`,
        );
      }

      const artifactPath = `plugins/${pluginId}/${version}/plugin.wasm`;
      const artifactUrl = baseUrl
        ? `${baseUrl}/${artifactPath}`
        : artifactPath;

      plugins.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        category: manifest.category,
        permissions: manifest.permissions,
        artifactUrl,
        sha256,
        minDdalabVersion: manifest.minDdalabVersion ?? null,
        publishedAt: new Date().toISOString(),
      });
    }
  }

  // Sort by id then version
  plugins.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));

  const index: RegistryIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    registryUrl: baseUrl,
    plugins,
  };

  const outPath = join(REGISTRY_DIR, "registry.json");
  await writeFile(outPath, JSON.stringify(index, null, 2) + "\n");
  console.log(
    `\nWrote ${outPath} with ${plugins.length} plugin(s).`,
  );
}

main().catch((err) => {
  console.error("Failed to build registry:", err);
  process.exit(1);
});
