#!/bin/sh
# The BIDS App entrypoint of the DDALAB container:
#   bids_dir output_dir participant [--participant_label LABEL ...] [ddalab batch options] [-- ddalab batch options]
#   bids_dir output_dir group       (nothing to do: every analysis is per recording)
#   --version | -h
# Runs `ddalab batch` once per participant (the named ones, else every sub-* folder) into output_dir/sub-<label>,
# which gets the result documents and the batch manifest batch.json, and writes a derivative dataset_description.json
# to output_dir. Arguments other than the labels go to `ddalab batch`.
set -eu
usage() {
  echo "usage: bids_dir output_dir {participant|group} [--participant_label LABEL ...] [ddalab batch options]"
}
case ${1:-} in
  --version | -v) exec ddalab --version ;;
  -h | --help) usage; exit 0 ;;
esac
[ $# -ge 3 ] || { usage >&2; exit 2; }
bids=$1 out=$2 level=$3
shift 3
case $level in
  participant) ;;
  group) echo "ddalab: nothing to do at the group level"; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

# The labels may stand anywhere before "--"; every other argument stays in "$@", in order, for ddalab batch.
labels="" named=false count=$#
while [ "$count" -gt 0 ]; do
  arg=$1
  shift
  count=$((count - 1))
  case $arg in
    --participant_label | --participant-label)
      named=true
      while [ "$count" -gt 0 ] && [ "${1#-}" = "$1" ]; do
        labels="$labels ${1#sub-}"
        shift
        count=$((count - 1))
      done
      ;;
    --)
      while [ "$count" -gt 0 ]; do
        set -- "$@" "$1"
        shift
        count=$((count - 1))
      done
      ;;
    *) set -- "$@" "$arg" ;;
  esac
done
if $named && [ -z "$labels" ]; then
  echo "ddalab: --participant_label needs at least one label" >&2
  exit 2
fi
[ -d "$bids" ] || { echo "ddalab: BIDS directory not found: $bids" >&2; exit 1; }
if ! $named; then
  for dir in "$bids"/sub-*/; do
    [ -d "$dir" ] && labels="$labels $(basename "$dir" | sed 's/^sub-//')"
  done
  [ -n "$labels" ] || { echo "ddalab: no sub-* folder in $bids" >&2; exit 1; }
fi

mkdir -p "$out"
version=$(ddalab --version | cut -d ' ' -f 2)
if [ ! -e "$out/dataset_description.json" ]; then
  cat > "$out/dataset_description.json" <<JSON
{
  "Name": "DDALAB delay differential analysis",
  "BIDSVersion": "1.9.0",
  "DatasetType": "derivative",
  "GeneratedBy": [{"Name": "ddalab", "Version": "$version", "CodeURL": "https://github.com/sdraeger/DDALAB"}]
}
JSON
fi
status=0
for label in $labels; do
  if [ ! -d "$bids/sub-$label" ]; then
    echo "ddalab: no sub-$label in $bids" >&2
    status=1
    continue
  fi
  mkdir -p "$out/sub-$label"
  ddalab batch --bids-dir "$bids/sub-$label" --output-dir "$out/sub-$label" "$@" > "$out/sub-$label/batch.json" || status=$?
done
exit $status
