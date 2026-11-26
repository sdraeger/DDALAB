#!/usr/bin/env bash
# Sets <version> in the Cargo workspace and its lockfile, npm packages, the dda-rs README pin, the EEGLAB plugin and
# CITATION.cff (whose date-released becomes today), then checks them with check-versions.sh. Run from the repository root:
#   scripts/set-version.sh 2.7.3
set -euo pipefail
version=${1:?usage: set-version.sh <version>}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "Not a version: $version" >&2; exit 1; }
# BSD and GNU sed differ on -i without a suffix.
edit() { sed -i.bak "$1" "$2" && rm "$2.bak"; }
# The first version line of root Cargo.toml is [workspace.package].version, inherited by all Rust crates.
edit "1,/^version = /s/^version = \".*\"/version = \"$version\"/" Cargo.toml
# Resolving rewrites the workspace lockfile's entries for the workspace crates and nothing else.
cargo metadata --offline --format-version 1 >/dev/null
edit "s/^  \"version\": \".*\",/  \"version\": \"$version\",/" packages/ddalab-wasm/package.json
# npm also sets the version in package-lock.json, which ddalab-wasm does not have.
(cd packages/ddalab-web && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)
edit "s/^dda-rs = \".*\"/dda-rs = \"$version\"/" packages/dda-rs/README.md
edit "s/^vers = '.*';/vers = '$version';/" packages/ddalab-eeglab/eegplugin_ddalab.m
edit "s/^version: .*/version: $version/; s/^date-released: .*/date-released: $(date -u +%F)/" CITATION.cff
scripts/check-versions.sh "v$version"
