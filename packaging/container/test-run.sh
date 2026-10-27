#!/bin/sh
# Tests the BIDS App entrypoint: test-run.sh <entrypoint command...>. The command takes the BIDS App arguments; a
# dataset of two subjects is made from the EDF fixture in a temporary directory, which the command must be able to read
# (for a container, mount it at the same path).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
fixture="$here/../../packages/dda-rs/tests/fixtures/fixture.edf"
work=${TEST_DIR:-$(mktemp -d)}
bids="$work/bids"
for s in 01 02; do
  mkdir -p "$bids/sub-$s/eeg"
  cp "$fixture" "$bids/sub-$s/eeg/sub-${s}_task-rest_eeg.edf"
done
printf '{"Name": "test", "BIDSVersion": "1.9.0"}\n' > "$bids/dataset_description.json"
fail() { echo "FAIL: $*" >&2; exit 1; }

"$@" --version | grep -q '^ddalab ' || fail "--version"

"$@" "$bids" "$work/all" participant --quiet
ls "$work/all"/*.dda.json >/dev/null 2>&1 || fail "no documents for the whole dataset"
[ "$(find "$work/all" -name "*.dda.json" | wc -l)" -eq 2 ] || fail "expected two documents"
grep -q '"DatasetType": "derivative"' "$work/all/dataset_description.json" || fail "derivative description"
[ -s "$work/all/batch.json" ] || fail "no batch manifest"

"$@" "$bids" "$work/one" participant --participant_label 02 -- --variants ST --wl 100 --quiet
[ -d "$work/one/sub-02" ] && [ ! -d "$work/one/sub-01" ] || fail "participant_label"
ls "$work/one/sub-02"/*.dda.json >/dev/null 2>&1 || fail "no document for sub-02"
grep -q '"window_length_samples": *100' "$work/one/sub-02"/*.dda.json || fail "batch options after --"

"$@" "$bids" "$work/group" group || fail "group level should succeed"
if "$@" "$bids" "$work/bad" participant --participant_label 99 2>/dev/null; then fail "a missing participant must fail"; fi
if "$@" "$bids" 2>/dev/null; then fail "missing arguments must fail"; fi
echo "BIDS App entrypoint: ok"
