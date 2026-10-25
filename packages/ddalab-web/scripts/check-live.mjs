// Checks the headers a host sends for a build of the app: HEAD requests for index.html, the entry script and the wasm
// module. Each must carry what public/.htaccess sets: the file's Content-Type, exactly one Cache-Control of the
// policy, no Expires and the Content-Security-Policy. A host that ignores the .htaccess, or adds defaults of its own,
// fails here.
// Usage: node scripts/check-live.mjs [site URL] [dist directory]
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleSizes } from "./check-bundle-size.mjs";
import { cspOf, IMMUTABLE, NO_CACHE } from "./policy.mjs";

export const SITE = "https://snl.salk.edu/~sfdraeger/ddalab";

const TYPES = {
  html: ["text/html"],
  js: ["text/javascript", "application/javascript"],
  wasm: ["application/wasm"],
};

const show = (value) => (value === undefined || value === null ? "missing" : `"${value}"`);

/** What is wrong with the `headers` (a Headers object) of a response for a file of `kind`: html, js or wasm. */
export function headerProblems(kind, headers, csp) {
  const problems = [];
  const type = headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!TYPES[kind].includes(type))
    problems.push(`Content-Type is ${show(type)}, expected ${TYPES[kind].join(" or ")}`);
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

/** The problems found on `site` for the build in `dist`, one line each with the URL; empty when the host is right. */
export async function checkLive(site, dist) {
  const csp = cspOf(readFileSync(join(dist, ".htaccess"), "utf8"));
  const { initial, wasm } = bundleSizes(dist);
  const script = initial.find((file) => file.name.endsWith(".js"));
  if (!script || wasm.length === 0) throw new Error(`${dist} holds no entry script or no wasm module`);
  const probes = [
    ["html", "index.html"],
    ["js", script.name],
    ["wasm", wasm[0].name],
  ];
  const problems = [];
  for (const [kind, name] of probes) {
    const url = `${site}/${name}`;
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) problems.push(`${url}: answered ${response.status}`);
    else problems.push(...headerProblems(kind, response.headers, csp).map((problem) => `${url}: ${problem}`));
  }
  return problems;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const site = process.argv[2] ?? SITE;
  const dist = process.argv[3] ?? fileURLToPath(new URL("../dist", import.meta.url));
  const problems = await checkLive(site, dist);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(
      `${site} does not send the headers of public/.htaccess; its folder needs AllowOverride FileInfo`,
    );
    process.exit(1);
  }
  console.log(`${site} sends the headers of public/.htaccess`);
}
