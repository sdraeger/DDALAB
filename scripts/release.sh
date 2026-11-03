#!/usr/bin/env bash
# Releases DDALAB <version> from main: sets the version everywhere (set-version.sh), commits "DDALAB <version>" (with the
# summary after a colon), tags v<version> and pushes both at once. The tag runs every publishing workflow, and
# channels.yml then checks that each channel serves the version. Run from the repository root:
#   scripts/release.sh 2.7.3 "MCP names its pair arguments"
set -euo pipefail
version=${1:?usage: release.sh <version> [summary]}
[[ "$(git branch --show-current)" == main ]] || { echo "Release from main" >&2; exit 1; }
git diff --quiet HEAD || { echo "Commit or stash the tracked changes first" >&2; exit 1; }
git pull --ff-only --quiet
scripts/set-version.sh "$version"
git commit --quiet --all --message "DDALAB $version${2:+: $2}"
git tag --annotate "v$version" --message "DDALAB $version"
git push --atomic origin main "v$version"
