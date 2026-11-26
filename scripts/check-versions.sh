#!/usr/bin/env bash
# Checks that every package, CITATION.cff, the dda-rs README pin and the EEGLAB plugin carry one version, and that a tag (the first argument, or GITHUB_REF_NAME
# when it names a tag) equals v<version>. Prints the version. Run from the repository root.
set -euo pipefail
cargo_version() { sed -n 's/^version = "\(.*\)"/\1/p' "$1" | head -n 1 | tr -d '\r'; }
version="$(cargo_version Cargo.toml)"
# Bash 3 (macOS runners) has no associative arrays: one line per package.
check() {
  if [[ "$2" != "$version" ]]; then
    echo "Versions differ: workspace $version, $1 $2" >&2
    exit 1
  fi
}
check_crate() {
  if grep -q '^version\.workspace = true' "$2"; then
    return 0
  fi
  check "$1" "$(cargo_version "$2")"
}
check_crate dda-rs packages/dda-rs/Cargo.toml
check_crate ddalab packages/ddalab-cli/Cargo.toml
check_crate ddalab-py packages/ddalab-py/Cargo.toml
check_crate ddalab-wasm packages/ddalab-wasm/Cargo.toml
check ddalab-wasm/package.json "$(sed -n 's/^  "version": "\(.*\)",/\1/p' packages/ddalab-wasm/package.json | head -n 1 | tr -d '\r')"
check ddalab-web "$(sed -n 's/^  "version": "\(.*\)",/\1/p' packages/ddalab-web/package.json | head -n 1 | tr -d '\r')"
check CITATION.cff "$(sed -n 's/^version: //p' CITATION.cff | tr -d '\r')"
check "the dda-rs README pin" "$(sed -n 's/^dda-rs = "\(.*\)"/\1/p' packages/dda-rs/README.md | tr -d '\r')"
check "the EEGLAB plugin" "$(sed -n "s/^vers = '\(.*\)';/\1/p" packages/ddalab-eeglab/eegplugin_ddalab.m | tr -d '\r')"
tag="${1:-}"
if [[ -z "$tag" && "${GITHUB_REF_TYPE:-}" == "tag" ]]; then tag="$GITHUB_REF_NAME"; fi
if [[ -n "$tag" && "$tag" != "v$version" ]]; then
  echo "Tag $tag does not match the package version $version" >&2
  exit 1
fi
echo "$version"
