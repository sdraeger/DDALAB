#!/usr/bin/env bash
# Checks that every package and CITATION.cff carry one version, and that a tag (the first argument, or GITHUB_REF_NAME
# when it names a tag) equals v<version>. Prints the version. Run from the repository root.
set -euo pipefail
cargo_version() { sed -n 's/^version = "\(.*\)"/\1/p' "$1" | head -n 1 | tr -d '\r'; }
version="$(cargo_version packages/dda-rs/Cargo.toml)"
# Bash 3 (macOS runners) has no associative arrays: one line per package.
check() {
  if [[ "$2" != "$version" ]]; then
    echo "Versions differ: dda-rs $version, $1 $2" >&2
    exit 1
  fi
}
check ddalab "$(cargo_version packages/ddalab-cli/Cargo.toml)"
check ddalab-py "$(cargo_version packages/ddalab-py/Cargo.toml)"
check ddalab-wasm "$(cargo_version packages/ddalab-wasm/Cargo.toml)"
check ddalab-web "$(sed -n 's/^  "version": "\(.*\)",/\1/p' packages/ddalab-web/package.json | head -n 1 | tr -d '\r')"
check CITATION.cff "$(sed -n 's/^version: //p' CITATION.cff | tr -d '\r')"
tag="${1:-}"
if [[ -z "$tag" && "${GITHUB_REF_TYPE:-}" == "tag" ]]; then tag="$GITHUB_REF_NAME"; fi
if [[ -n "$tag" && "$tag" != "v$version" ]]; then
  echo "Tag $tag does not match the package version $version" >&2
  exit 1
fi
echo "$version"
