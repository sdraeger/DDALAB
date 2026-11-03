#!/usr/bin/env bash
# Sets <version> in every package and its lockfile, the dda-rs README pin, the EEGLAB plugin and CITATION.cff (whose
# date-released becomes today), then checks them with check-versions.sh. Run from the repository root:
#   scripts/set-version.sh 2.7.3
set -euo pipefail
version=${1:?usage: set-version.sh <version>}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "Not a version: $version" >&2; exit 1; }
# BSD and GNU sed differ on -i without a suffix.
edit() { sed -i.bak "$1" "$2" && rm "$2.bak"; }
for crate in dda-rs ddalab-cli ddalab-py ddalab-wasm; do
  # The first version line of a Cargo.toml is its package's.
  edit "1,/^version = /s/^version = \".*\"/version = \"$version\"/" "packages/$crate/Cargo.toml"
  # Resolving rewrites the lockfile's entries of the crate and of its path dependency dda-rs, and nothing else.
  (cd "packages/$crate" && cargo metadata --offline --format-version 1 >/dev/null)
done
edit "s/^  \"version\": \".*\",/  \"version\": \"$version\",/" packages/ddalab-wasm/package.json
# npm also sets the version in package-lock.json, which ddalab-wasm does not have.
(cd packages/ddalab-web && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)
edit "s/^dda-rs = \".*\"/dda-rs = \"$version\"/" packages/dda-rs/README.md
edit "s/^vers = '.*';/vers = '$version';/" packages/ddalab-eeglab/eegplugin_ddalab.m
edit "s/^version: .*/version: $version/; s/^date-released: .*/date-released: $(date -u +%F)/" CITATION.cff
scripts/check-versions.sh "v$version"
