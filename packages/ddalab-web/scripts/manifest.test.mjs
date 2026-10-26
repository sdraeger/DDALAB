// public/manifest.webmanifest: the fields an installable app needs, icons that exist at their sizes, and file handlers
// for the formats the app reads. Nothing reads the manifest at build time: a slip shows only in an install.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { isProject, RANK } from "../src/core/sources";

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);
const manifest = JSON.parse(readFileSync(publicFile("manifest.webmanifest"), "utf8"));

test("the_manifest_names_an_app_that_opens_in_its_own_window_from_its_folder", () => {
  expect(manifest).toMatchObject({
    name: "DDALAB",
    short_name: "DDALAB",
    start_url: "./",
    scope: "./",
    display: "standalone",
    // Chromium draws the command bar in the title bar (Shell.module.css); other browsers keep standalone.
    display_override: ["window-controls-overlay"],
  });
  expect(manifest.description).toBeTruthy();
  // A later launch goes to the window that is open, where the launch queue's consumer takes its files.
  expect(manifest.launch_handler).toEqual({ client_mode: "focus-existing" });
});

// Browsers fix the identity of an installed app at its first install. An `id` of "./" resolves to the root of the
// origin, which every other app there shares. Without an id the identity is the start URL: the app's own folder.
test("the_identity_is_the_apps_folder_on_every_host", () => {
  expect(manifest).not.toHaveProperty("id");
  for (const folder of [
    "https://sdraeger.github.io/DDALAB/",
    "https://snl.salk.edu/~sfdraeger/ddalab/",
    "https://internal.example/tools/",
  ]) {
    expect(new URL(manifest.start_url, `${folder}manifest.webmanifest`).href).toBe(folder);
    expect(new URL(manifest.scope, `${folder}manifest.webmanifest`).href).toBe(folder);
  }
});

test("the_colors_are_the_light_chrome_token", () => {
  const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const chrome = /--chrome: light-dark\((#[0-9a-f]{6}),/i.exec(tokens)?.[1];
  expect(manifest.theme_color.toLowerCase()).toBe(chrome?.toLowerCase());
  expect(manifest.background_color.toLowerCase()).toBe(chrome?.toLowerCase());
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  expect(page).toContain('<link rel="manifest" href="./manifest.webmanifest" />');
  expect(
    page.match(/<meta name="theme-color"[^>]*media="\(prefers-color-scheme: (?:light|dark)\)"/g),
  ).toHaveLength(2);
});

test("the_icons_exist_at_the_sizes_they_claim_and_one_is_maskable", () => {
  expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "512x512 maskable",
  ]);
  for (const icon of manifest.icons) {
    const png = readFileSync(publicFile(icon.src));
    expect(icon.type).toBe("image/png");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
});

test("the_file_handlers_cover_the_formats_the_app_reads", () => {
  expect(manifest.file_handlers).toHaveLength(1);
  const [{ action, accept }] = manifest.file_handlers;
  // The action is a page in the scope: the folder itself, where the launch queue delivers the files.
  expect(new URL(action, "https://example.test/app/").href).toBe("https://example.test/app/");
  const extensions = Object.values(accept).flat();
  for (const [type, list] of Object.entries(accept)) {
    expect(type).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
    expect(list.length).toBeGreaterThan(0);
  }
  for (const extension of extensions) {
    expect(extension).toMatch(/^\.[a-z0-9]+$/);
    // A project opens as its tabs (app/project.ts); the others are recordings.
    if (!isProject(extension)) {
      expect(RANK, `${extension} is not a format the app opens`).toHaveProperty(extension.slice(1));
    }
  }
  expect(extensions.sort()).toEqual([".bdf", ".csv", ".ddalab", ".edf", ".set", ".tsv", ".txt", ".vhdr"]);
});
