// Builds the app, runs the dist and size checks (`npm run build`), and copies dist/ to the SNL web space, which
// Apache serves from ~/public_html/ddalab on the cluster's shared home. Without --publish rsync only lists what it
// would change. --delete removes what the new build no longer has (old hashed assets), so --publish refuses a
// target that holds another site (one without an assets/ directory) unless --replace is given.
// Usage: npm run deploy:snl [-- --publish [--replace]]
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = "https://snl.salk.edu/~sfdraeger/ddalab";
const TARGET = "public_html/ddalab";
const [publish, replace] = ["--publish", "--replace"].map((flag) => process.argv.includes(flag));
const cwd = fileURLToPath(new URL("..", import.meta.url));
const run = (command, args) => execFileSync(command, args, { cwd, stdio: "inherit" });

// Exit 0: the target is absent, empty or an earlier deploy of this app. Exit 1: it holds something else.
const { status } = spawnSync("ssh", [
  "node32",
  `[ -z "$(ls -A ${TARGET} 2>/dev/null)" ] || [ -d ${TARGET}/assets ]`,
]);
if (status !== 0 && status !== 1) throw new Error(`ssh node32 failed with status ${status}`);
if (status === 1) {
  console.warn(`node32:${TARGET} holds another site, which --delete would remove`);
  if (publish && !replace) {
    console.error("move it away first, or pass --replace to publish over it");
    process.exit(1);
  }
}

run("npm", ["run", "build"]);
// Apache needs world-readable files and searchable directories whatever the local umask.
run("rsync", [
  "-a",
  "--delete",
  "--chmod=D755,F644",
  "--itemize-changes",
  ...(publish ? [] : ["--dry-run"]),
  "dist/",
  `node32:${TARGET}/`,
]);
console.log(publish ? `published ${SITE}` : `dry run, nothing copied; --publish copies it to ${SITE}`);
