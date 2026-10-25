import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("deploy-snl.mjs", import.meta.url));

// ssh, rsync and npm are stubs that log their arguments; ssh answers with SSH_STATUS (the guard: 0 free, 1 foreign).
let bin;
let log;
beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "deploy-snl-"));
  log = join(bin, "calls.log");
  for (const [name, exit] of [
    ["ssh", '"$SSH_STATUS"'],
    ["rsync", "0"],
    ["npm", "0"],
  ]) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit ${exit}\n`);
    chmodSync(join(bin, name), 0o755);
  }
});
afterEach(() => rmSync(bin, { recursive: true }));

function deploy(args, sshStatus = 0) {
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SSH_STATUS: String(sshStatus) };
  const { status, stdout, stderr } = spawnSync(process.execPath, [SCRIPT, ...args], {
    env,
    encoding: "utf8",
  });
  let calls = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n");
  } catch {
    // No stub ran.
  }
  return { status, stdout, stderr, calls };
}

test("a_dry_run_is_the_default", () => {
  const { status, stdout, calls } = deploy([]);
  expect(status).toBe(0);
  expect(stdout).toContain("dry run, nothing copied");
  expect(calls.map((call) => call.split(" ")[0])).toEqual(["ssh", "npm", "rsync", "rsync"]);
  const [assets, all] = calls.slice(2);
  expect(assets).toContain("--dry-run");
  expect(assets).toContain("--exclude=/index.html");
  expect(assets).not.toContain("--delete");
  expect(all).toContain("--dry-run");
  expect(all).toContain("--delete-delay");
  expect(all).not.toContain("--exclude");
});

test("a_dry_run_over_another_site_warns_and_still_lists", () => {
  const { status, stderr, calls } = deploy([], 1);
  expect(status).toBe(0);
  expect(stderr).toContain("holds another site");
  expect(calls.filter((call) => call.startsWith("rsync") && call.includes("--dry-run"))).toHaveLength(2);
});

test("publish_refuses_another_site", () => {
  const { status, stderr, calls } = deploy(["--publish"], 1);
  expect(status).toBe(1);
  expect(stderr).toContain("--replace");
  expect(calls.map((call) => call.split(" ")[0])).toEqual(["ssh"]);
});

test("the_guard_asks_for_the_marker_without_a_password_prompt", () => {
  const [ssh] = deploy([]).calls;
  expect(ssh).toContain("-o BatchMode=yes node32");
  expect(ssh).toContain("public_html/ddalab/.ddalab-web");
});

test("an_ssh_failure_stops_before_the_build", () => {
  const { status, calls } = deploy(["--publish", "--replace"], 255);
  expect(status).not.toBe(0);
  expect(calls.map((call) => call.split(" ")[0])).toEqual(["ssh"]);
});
