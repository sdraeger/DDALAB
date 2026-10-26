// Renders the icons from public/favicon.svg (the Echo mark on its light tile) in headless Chromium. The PNG favicons
// (16 and 32 px) are the whole favicon, tile and all, for browsers that do not take the SVG. The app icons of the web
// manifest are the mark on the light chrome color #F1F3F5, centered: the two plain icons (192 and 512 px) fill 60% of
// their width; the maskable 512 px icon keeps the mark inside the 40%-radius circle every launcher mask leaves
// visible: its box is 56% wide, so the mark's corners lie at 39.2% of the icon from the center.
// Usage: node scripts/make-icons.mjs   (writes public/favicon-16.png, favicon-32.png, icon-192.png, icon-512.png and
// icon-maskable-512.png)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const favicon = readFileSync(here("../public/favicon.svg"), "utf8");
// The mark without the svg element, its title and its tile: the app icons draw their own background.
const art = favicon.replace(/<\/?svg[^>]*>|<title>.*?<\/title>|<rect class="tile"[^>]*\/>/g, "");
// The mark spans x 5 to 28.5 and y 4.5 to 27.5 of the favicon's 32 unit square (the echo's round cap reaches 27.5).
const BOX = { x: 5, y: 4.5, width: 23.5, height: 23 };
const BACKGROUND = "#F1F3F5";

const icons = [
  ["icon-192.png", 192, 0.6],
  ["icon-512.png", 512, 0.6],
  ["icon-maskable-512.png", 512, 0.56],
];

const browser = await chromium.launch();
for (const size of [16, 32]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin:0">${favicon.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body>`,
  );
  // The tile's rounded corners stay transparent.
  await page.screenshot({ path: here(`../public/favicon-${size}.png`), omitBackground: true });
  await page.close();
}
for (const [file, size, fill] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, colorScheme: "light" });
  const side = BOX.width / fill; // units across the whole icon
  const x = BOX.x + BOX.width / 2 - side / 2;
  const y = BOX.y + BOX.height / 2 - side / 2;
  await page.setContent(
    `<body style="margin:0;background:${BACKGROUND}"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${x} ${y} ${side} ${side}" style="display:block">${art}</svg></body>`,
  );
  await page.screenshot({ path: here(`../public/${file}`) });
  await page.close();
}
await browser.close();
