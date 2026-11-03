#!/usr/bin/env bash
# Prints each channel that does not serve DDALAB <version> yet, one per line, and exits 1 if there is any:
#   scripts/check-channels.sh 2.7.3
# npm is checked when NPM_PUBLISH is "true", as npm.yml publishes only then. A pre-release (a "-" in the version) reaches
# only the GitHub release, PyPI, npm and the images: the site, Homebrew and Scoop follow the latest release. Needs gh, jq.
set -uo pipefail
v=${1:?usage: check-channels.sh <version>}
missing=0
miss() { echo "$1"; missing=1; }
serves() { curl -fsL -o /dev/null "$@"; }
# The contents API, since raw.githubusercontent.com serves a copy up to five minutes old.
contents() { gh api -H "Accept: application/vnd.github.raw" "repos/sdraeger/$1/contents/$2"; }

assets="$(gh release view "v$v" --repo sdraeger/DDALAB --json assets -q '.assets[].name' 2>/dev/null)"
for asset in ddalab-aarch64-apple-darwin.tar.xz ddalab-x86_64-apple-darwin.tar.xz ddalab-x86_64-unknown-linux-gnu.tar.xz \
  ddalab-x86_64-pc-windows-msvc.zip ddalab-installer.sh ddalab-installer.ps1 "ddalab-wasm-$v.tgz" "ddalab-web-$v.zip"; do
  grep -qx "$asset" <<<"$assets" || miss "GitHub release: $asset"
done
serves "https://pypi.org/pypi/ddalab/$v/json" || miss "PyPI: ddalab $v"
if [[ "${NPM_PUBLISH:-}" == true ]]; then
  serves "https://registry.npmjs.org/ddalab-wasm/$v" || miss "npm: ddalab-wasm $v"
fi
for image in ddalab ddalab-web; do
  token="$(curl -fs "https://ghcr.io/token?scope=repository:sdraeger/$image:pull" | jq -r .token)"
  serves -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json" \
    "https://ghcr.io/v2/sdraeger/$image/manifests/$v" || miss "ghcr.io: $image:$v"
done

if [[ "$v" != *-* ]]; then
  # The site serves the tag's bundle when its index.html is the one in the release's web zip.
  tmp="$(mktemp -d)"
  if gh release download "v$v" --repo sdraeger/DDALAB --pattern "ddalab-web-$v.zip" --dir "$tmp" 2>/dev/null &&
    [[ "$(unzip -p "$tmp/ddalab-web-$v.zip" index.html | shasum)" == "$(curl -fs https://ddalab.org/index.html | shasum)" ]]; then
    :
  else
    miss "ddalab.org: $v"
  fi
  rm -rf "$tmp"
  contents homebrew-tap Formula/ddalab.rb | grep -q "version \"$v\"" ||
    miss "Homebrew: sdraeger/tap/ddalab $v"
  [[ "$(contents scoop-bucket bucket/ddalab.json | jq -r .version)" == "$v" ]] ||
    miss "Scoop: ddalab $v"
fi
exit "$missing"
