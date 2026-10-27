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

"$@" -h | grep -q 'participant_label' || fail "-h prints the usage"

# Every participant, each in its own folder as a named one is.
"$@" "$bids" "$work/all" participant --quiet
for s in 01 02; do
  ls "$work/all/sub-$s"/*.dda.json >/dev/null 2>&1 || fail "no document for sub-$s"
  [ -s "$work/all/sub-$s/batch.json" ] || fail "no batch manifest for sub-$s"
done
grep -q '"DatasetType": "derivative"' "$work/all/dataset_description.json" || fail "derivative description"

"$@" "$bids" "$work/one" participant --participant_label 02 -- --variants ST --wl 100 --quiet
[ -d "$work/one/sub-02" ] && [ ! -d "$work/one/sub-01" ] || fail "participant_label"
ls "$work/one/sub-02"/*.dda.json >/dev/null 2>&1 || fail "no document for sub-02"
grep -q '"window_length_samples": *100' "$work/one/sub-02"/*.dda.json || fail "batch options after --"

# Options may come before the labels.
"$@" "$bids" "$work/two" participant --wl 100 --participant_label sub-01 --quiet
[ -d "$work/two/sub-01" ] && [ ! -d "$work/two/sub-02" ] || fail "labels after an option"
grep -q '"window_length_samples": *100' "$work/two/sub-01"/*.dda.json || fail "an option before the labels"

if "$@" "$bids" "$work/none" participant --participant_label 2>/dev/null; then fail "an empty label list must fail"; fi
if "$@" "$bids" "$work/none" participant --participant_label -- --quiet 2>/dev/null; then fail "labels then -- must fail"; fi
"$@" "$bids" "$work/group" group || fail "group level should succeed"
if "$@" "$bids" "$work/bad" participant --participant_label 99 2>/dev/null; then fail "a missing participant must fail"; fi
if "$@" "$bids" 2>/dev/null; then fail "missing arguments must fail"; fi
echo "BIDS App entrypoint: ok"
