#!/bin/sh
# The BIDS App entrypoint of the DDALAB container:
#   bids_dir output_dir participant [--participant_label LABEL ...] [-- ddalab batch options]
#   bids_dir output_dir group       (nothing to do: every analysis is per recording)
#   --version
# Runs `ddalab batch` over the dataset, or once per named participant into output_dir/sub-<label>, and writes the
# result documents, the batch manifest (batch.json) and a derivative dataset_description.json to output_dir.
set -eu
usage() {
  echo "usage: bids_dir output_dir {participant|group} [--participant_label LABEL ...] [-- ddalab batch options]" >&2
  exit 2
}
if [ "${1:-}" = "--version" ] || [ "${1:-}" = "-v" ]; then exec ddalab --version; fi
[ $# -ge 3 ] || usage
bids=$1 out=$2 level=$3
shift 3
case $level in
  participant) ;;
  group) echo "ddalab: nothing to do at the group level"; exit 0 ;;
  *) usage ;;
esac
labels=""
while [ $# -gt 0 ]; do
  case $1 in
    --participant_label | --participant-label)
      shift
      while [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; do
        labels="$labels ${1#sub-}"
        shift
      done
      ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ -d "$bids" ] || { echo "ddalab: BIDS directory not found: $bids" >&2; exit 1; }
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
if [ -z "$labels" ]; then
  exec ddalab batch --bids-dir "$bids" --output-dir "$out" "$@" > "$out/batch.json"
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
