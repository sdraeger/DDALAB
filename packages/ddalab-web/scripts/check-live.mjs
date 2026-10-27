// Checks a deployed build of the app with requests for the folder, index.html, the entry script, a style sheet and the
// wasm module.
// - Apache with public/.htaccess (the default): each must carry what public/.htaccess sets: the file's
//   Content-Type, exactly one Cache-Control of the policy, no Expires and the Content-Security-Policy header. A host that
//   ignores the .htaccess, or adds defaults of its own, fails here.
// - --pages (GitHub Pages; npm run check:pages): Pages sends its own headers and ignores the .htaccess. The header
//   checks are skipped: Cache-Control, Expires and the Content-Security-Policy header. Each file must carry its
//   Content-Type (application/wasm for the module), and index.html must carry the <meta> Content-Security-Policy of
//   public/.htaccess.
// A host that does not answer fails in both.
// Usage: node scripts/check-live.mjs [--pages] [site URL] [dist directory]
// The site defaults to https://sdraeger.github.io/DDALAB/ with --pages (project paths are case-sensitive); an Apache
// host is named.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleSizes } from "./check-bundle-size.mjs";
import { cspOf, IMMUTABLE, metaCspOf, NO_CACHE } from "./policy.mjs";

export const PAGES_SITE = "https://sdraeger.github.io/DDALAB/";

const TYPES = {
  html: ["text/html"],
  js: ["text/javascript", "application/javascript"],
  css: ["text/css"],
  wasm: ["application/wasm"],
};

const show = (value) => (value === undefined || value === null ? "missing" : `"${value}"`);

/** The problem with the Content-Type in the `headers` (a Headers object) of a response for a file of `kind`, if any. */
export function typeProblems(kind, headers) {
  const type = headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return TYPES[kind].includes(type)
    ? []
    : [`Content-Type is ${show(type)}, expected ${TYPES[kind].join(" or ")}`];
}

/** What is wrong with the `headers` (a Headers object) of a response for a file of `kind`: html, js, css or wasm. */
export function headerProblems(kind, headers, csp) {
  const problems = typeProblems(kind, headers);
  const cache = kind === "html" ? NO_CACHE : IMMUTABLE;
  if (headers.get("cache-control") !== cache)
    problems.push(
      `Cache-Control is ${show(headers.get("cache-control"))}, expected the single value "${cache}"`,
    );
  if (headers.has("expires"))
    problems.push(`Expires is set (${headers.get("expires")}); the policy has no Expires`);
  const policy = headers.get("content-security-policy")?.replace(/\s+/g, " ").trim();
  if (policy !== csp) problems.push(`Content-Security-Policy is ${show(policy)}, expected "${csp}"`);
  return problems;
}

/**
 * The problems found on `site` for the build in `dist`, one line each with the URL; empty when the host is right.
 * `pages` checks as GitHub Pages is checked (see the top of this file).
 */
export async function checkLive(site, dist, { pages = false } = {}) {
  site = site.replace(/\/+$/, "");
  const csp = cspOf(readFileSync(join(dist, ".htaccess"), "utf8"));
  const { initial, wasm } = bundleSizes(dist);
  const script = initial.find((file) => file.name.endsWith(".js"));
  const style = readdirSync(dist, { recursive: true }).find((name) => name.endsWith(".css"));
  if (!script || !style || wasm.length === 0)
    throw new Error(`${dist} holds no entry script, no style sheet or no wasm module`);
  // The folder itself is the address people open; the host answers it with index.html.
  const probes = [
    ["html", ""],
    ["html", "index.html"],
    ["js", script.name],
    ["css", style],
    ["wasm", wasm[0].name],
  ];
  const problems = [];
  for (const [kind, name] of probes) {
    const url = `${site}/${name}`;
    // On Pages the HTML is fetched whole, for the <meta> policy it carries.
    const page = pages && kind === "html";
    let response;
    try {
      response = await fetch(url, { method: page ? "GET" : "HEAD" });
    } catch (error) {
      // fetch rejects with "fetch failed" and keeps the reason (DNS, refused, TLS) in `cause`.
      problems.push(`${url}: no answer (${error.cause?.message ?? error.message})`);
      continue;
    }
    if (!response.ok) {
      problems.push(`${url}: answered ${response.status}`);
      continue;
    }
    const found = pages ? typeProblems(kind, response.headers) : headerProblems(kind, response.headers, csp);
    if (page) {
      const meta = metaCspOf(await response.text());
      if (meta !== csp) found.push(`the <meta> Content-Security-Policy is ${show(meta)}, expected "${csp}"`);
    }
    problems.push(...found.map((problem) => `${url}: ${problem}`));
  }
  return problems;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const pages = process.argv.includes("--pages");
  const [site = pages ? PAGES_SITE : undefined, dist = fileURLToPath(new URL("../dist", import.meta.url))] =
    process.argv.slice(2).filter((arg) => arg !== "--pages");
  if (!site) {
    console.error("name the site: node scripts/check-live.mjs <site URL> [dist directory], or --pages");
    process.exit(2);
  }
  if (pages)
    console.log(
      "skipped: Cache-Control, Expires and the Content-Security-Policy header (Pages sets its own headers and ignores public/.htaccess)",
    );
  const problems = await checkLive(site, dist, { pages });
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(
      pages
        ? `${site} fails the check`
        : `${site} fails the check; a folder that answers without the headers needs AllowOverride FileInfo`,
    );
    process.exit(1);
  }
  console.log(
    pages
      ? `${site} sends the Content-Types (application/wasm for the module) and carries the policy of public/.htaccess as the <meta> of index.html`
      : `${site} sends the headers of public/.htaccess`,
  );
}
