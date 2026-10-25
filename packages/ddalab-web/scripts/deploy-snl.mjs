// Builds the app, runs the dist and size checks (`npm run build`) and copies dist/ to the SNL web space, which Apache
// serves from ~/public_html/ddalab on the cluster's shared home. Without --publish rsync only lists what it would
// change.
// A publish copies everything except index.html first, then index.html with --delete-delay. No page then points at a
// file that is not there yet, and old files go last. A target that is not empty and lacks the .ddalab-web marker (the
// build writes it into dist) belongs to another site: --publish refuses it unless --replace is given. After a
// publish, HEAD requests check the headers the host sends (check-live.mjs); a mismatch exits non-zero.
// Usage: npm run deploy:snl [-- --publish [--replace]]
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkLive, SITE } from "./check-live.mjs";

const TARGET = "public_html/ddalab";
const [publish, replace] = ["--publish", "--replace"].map((flag) => process.argv.includes(flag));
const root = fileURLToPath(new URL("..", import.meta.url));
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

// Exit 0: the target is absent, empty or an earlier deploy of this app. Exit 1: it holds another site.
const guard = `[ -z "$(ls -A ${TARGET} 2>/dev/null)" ] || [ -f ${TARGET}/.ddalab-web ]`;
const { status } = spawnSync("ssh", ["-o", "BatchMode=yes", "node32", guard], {
  stdio: ["ignore", "ignore", "inherit"],
});
if (status !== 0 && status !== 1) throw new Error(`ssh node32 failed with status ${status}`);
if (status === 1) {
  console.warn(`node32:${TARGET} holds another site, which the second rsync pass would delete`);
  if (publish && !replace) {
    console.error("move it away first, or pass --replace to publish over it");
    process.exit(1);
  }
}

run("npm", ["run", "build"]);
// Apache needs world-readable files and searchable directories whatever the local umask.
const rsync = [
  "-a",
  "--chmod=D755,F644",
  "--itemize-changes",
  ["-e", "ssh -o BatchMode=yes"],
  publish ? [] : ["--dry-run"],
].flat();
run("rsync", [...rsync, "--exclude=/index.html", "dist/", `node32:${TARGET}/`]);
run("rsync", [...rsync, "--delete-delay", "dist/", `node32:${TARGET}/`]);

if (!publish) {
  console.log(`dry run, nothing copied; --publish copies it to ${SITE}`);
} else {
  const problems = await checkLive(SITE, `${root}dist`);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(`published ${SITE}, but the host does not send the headers of public/.htaccess`);
    process.exit(1);
  }
  console.log(`published ${SITE}; the host sends the headers of public/.htaccess`);
}
