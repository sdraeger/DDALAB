import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import { headerProblems } from "./check-live.mjs";
import { cspOf, IMMUTABLE, NO_CACHE } from "./policy.mjs";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("check-live.mjs", import.meta.url));
const HTACCESS = readFileSync(new URL("../public/.htaccess", import.meta.url), "utf8");

// Header lines of recorded responses (`curl -I`). The live-* files are the userdir host on 2026-10-25, before any publish:
// its own defaults only. The apache-* files are an Apache 2.4.67 with those same defaults (mod_expires for HTML and
// CSS, three security headers) and public/.htaccess applied, recorded with `curl -I -H 'Accept-Encoding: gzip'`.
const lines = (name) =>
  readFileSync(new URL(`fixtures/headers/${name}.txt`, import.meta.url), "utf8")
    .split("\n")
    .slice(1)
    .filter((line) => line.includes(": "))
    .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]);
const recorded = (name) => {
  const headers = new Headers();
  for (const [key, value] of lines(name)) headers.append(key, value);
  return headers;
};
// The policy the apache-* fixtures were recorded with. A later change of public/.htaccess does not touch them.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://openneuro.org https://s3.amazonaws.com; worker-src 'self'; img-src 'self' blob: data:; style-src 'self'; base-uri 'none'; form-action 'none'";

test.each([
  ["html", "apache-index"],
  ["js", "apache-js"],
  ["wasm", "apache-wasm"],
])("a_host_with_the_htaccess_applied_passes (%s)", (kind, fixture) => {
  expect(headerProblems(kind, recorded(fixture), CSP)).toEqual([]);
});

test("the_hosts_own_defaults_fail_for_html", () => {
  expect(headerProblems("html", recorded("live-index"), CSP)).toEqual([
    'Cache-Control is "max-age=300", expected the single value "no-cache"',
    expect.stringMatching(/^Expires is set \(/),
    expect.stringMatching(/^Content-Security-Policy is missing, expected /),
  ]);
});

test("the_hosts_own_defaults_fail_for_js", () => {
  expect(headerProblems("js", recorded("live-script-js"), CSP)).toEqual([
    `Cache-Control is missing, expected the single value "${IMMUTABLE}"`,
    expect.stringMatching(/^Content-Security-Policy is missing, expected /),
  ]);
});

test("a_second_cache_control_is_found", () => {
  const headers = recorded("apache-index");
  headers.append("Cache-Control", "max-age=300");
  expect(headerProblems("html", headers, CSP)).toEqual([
    'Cache-Control is "no-cache, max-age=300", expected the single value "no-cache"',
  ]);
});

test("an_expires_header_is_found", () => {
  const headers = recorded("apache-js");
  headers.set("Expires", "Sun, 25 Oct 2026 21:57:12 GMT");
  expect(headerProblems("js", headers, CSP)).toEqual([expect.stringMatching(/^Expires is set/)]);
});

test("wasm_without_its_mime_type_is_found", () => {
  const headers = recorded("apache-wasm");
  headers.set("Content-Type", "application/octet-stream");
  expect(headerProblems("wasm", headers, CSP)).toEqual([
    'Content-Type is "application/octet-stream", expected application/wasm',
  ]);
});

test("a_changed_csp_is_found", () => {
  const headers = recorded("apache-index");
  headers.set("Content-Security-Policy", "default-src 'self'");
  expect(headerProblems("html", headers, CSP)).toEqual([
    expect.stringMatching(/^Content-Security-Policy is "default-src 'self'", expected /),
  ]);
});

test("the_htaccess_sets_the_policy_the_check_expects", () => {
  expect(HTACCESS).toContain(`Header set Cache-Control "${IMMUTABLE}"`);
  expect(HTACCESS).toContain(`Header set Cache-Control "${NO_CACHE}"`);
  expect(HTACCESS).toContain("Header unset Expires");
  const csp = cspOf(HTACCESS);
  for (const part of ["default-src 'self'", "'wasm-unsafe-eval'", "connect-src 'self'", "worker-src 'self'"])
    expect(csp).toContain(part);
  expect(csp).not.toMatch(/\\|\s{2}/);
});

test("the_build_writes_the_files_deploy_and_apache_need", () => {
  for (const name of [".htaccess", ".ddalab-web"])
    expect(readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8")).not.toBe("");
});

// The script against a local server that answers with recorded headers.
let dist;
let server;
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "check-live-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><script type="module" src="./assets/app.js"></script><div id="root"></div>',
  );
  writeFileSync(join(dist, "assets", "app.js"), "export {};");
  writeFileSync(join(dist, "assets", "engine.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFileSync(join(dist, ".htaccess"), `Header always set Content-Security-Policy "${CSP}"\n`);
});
afterEach(() => {
  server?.close();
  rmSync(dist, { recursive: true });
});

/** Starts a server whose HTML, script and wasm answers are the recorded `html`, `js` and `wasm` fixtures. */
async function serving({ html, js, wasm }) {
  const skip = new Set([
    "date",
    "server",
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
  ]);
  server = createServer((request, response) => {
    const name = request.url.endsWith(".wasm") ? wasm : request.url.endsWith(".js") ? js : html;
    response.writeHead(
      200,
      lines(name).filter(([key]) => !skip.has(key.toLowerCase())),
    );
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}/~user/ddalab`;
}
const check = (site) => run("node", [SCRIPT, site, dist]).catch((error) => error);

test("the_script_passes_a_host_that_sends_the_policy", async () => {
  const site = await serving({ html: "apache-index", js: "apache-js", wasm: "apache-wasm" });
  const { stdout } = await run("node", [SCRIPT, site, dist]);
  expect(stdout).toContain("sends the headers of public/.htaccess");
});

test("the_script_exits_non_zero_with_a_clear_message_on_the_hosts_defaults", async () => {
  const site = await serving({ html: "live-index", js: "live-script-js", wasm: "live-script-js" });
  const error = await check(site);
  expect(error.code).toBe(1);
  expect(error.stderr).toContain(`${site}/index.html: Cache-Control is "max-age=300"`);
  expect(error.stderr).toContain(`${site}/assets/app.js: Content-Security-Policy is missing`);
  expect(error.stderr).toContain(`${site}/assets/engine.wasm: Content-Type is "application/javascript"`);
  expect(error.stderr).toContain("AllowOverride FileInfo");
});
