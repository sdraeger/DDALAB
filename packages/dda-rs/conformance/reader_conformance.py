"""Do the Rust readers (ddalab) return the samples, labels, rate, length and annotation onsets of MNE?

For each recording, with Rust values from `ddalab inspect --json` and `ddalab samples`, and MNE values from
`read_raw_edf`, `read_raw_bdf` or `read_raw_brainvision` (preload=False) and `raw.get_data` (SI units):

  A        = analysis_channels of the Rust inspection (Signal channels at the recording rate), C = |A|
  f, N     = Rust sample_rate_hz and sample_count;   f_mne = raw.info['sfreq'], N_mne = raw.n_times
  n        = min(round(segment_s * f), N);   s_k = k * (N - n) // (K - 1), k = 0..K-1   (K = n_segments: start, middle, end)
  x_rust_k = ddalab samples, channels A, samples s_k .. s_k + n - 1, shape (C, n)
  x_mne_k  = raw.get_data(picks = labels of A, start = s_k, stop = s_k + n), shape (C, n). MNE returns the unscaled digital
             values of a channel it types stim; for these x_mne_k is replaced by x_mne_k * gain + offset (Rust's gain and offset).
             The comparison then covers the decoding of the digital values and leaves the calibration out. n_stim counts these channels.
  Concatenating the K segments gives x_rust and x_mne of shape (C, K * n). For a channel c:
  max_abs_c = max over samples of |x_rust[c] - x_mne[c]|;   max_ref_c = max over samples of |x_mne[c]|
  max_abs  = max over c of max_abs_c;   max_ref = max over c of max_ref_c
  max_rel  = max_abs / max_ref   (0 if max_abs = 0 = max_ref; inf if max_ref = 0 < max_abs).  The whole file shares one scale max_ref.
  max_rel_channel = max over c of max_abs_c / max_ref_c   (each channel on its own scale).  A channel with max_ref_c = 0 is skipped
             when max_abs_c = 0 (counted in n_zero_ref_channels) and gives inf when max_abs_c > 0.
  labels_equal = [label of Rust channels with kind != Annotation] == raw.ch_names
  rate_equal = (f == f_mne);  count_equal = (N == N_mne)
  a_rust   = sort(onset_s of the Rust annotations with source != events.tsv, which MNE does not read)
  a_mne    = sort(raw.annotations.onset - raw.first_time) if raw.annotations.orig_time is not None, else sort(raw.annotations.onset).
             With an orig_time (the recording has a meas_date) MNE counts onsets from meas_date and first_time = first_samp / f_mne
             moves them to the first sample; without one they already start at the first sample.
  onset_max_diff = max |a_rust - a_mne| over the annotations; nan if the counts differ.
  onset_max_diff_wo_first_new_segment is the same with the first Rust annotation labelled "New Segment" removed from a_rust
             (MNE turns the first BrainVision marker of that type into meas_date).
  gate_pass = labels_equal and rate_equal and count_equal and n_compared == C and (C == 0 or max_rel_channel <= tol_rel)
  single_rate, edf_d = read from the EDF/BDF header (samples per record of all non-annotation signals are equal; reserved field
             starts with EDF+D or BDF+D), independent of both readers; BrainVision files get single_rate = True and edf_d = False. MNE resamples
             mixed-rate EDF and concatenates EDF+D records, which prevents a sample-by-sample comparison, and such files are listed as
             deviating. For a mixed-rate file whose MNE rate equals f the channels at f are compared (MNE resamples only the slower ones).

Every aggregate runs over one file: its C channels and K segments. The per-corpus summary (reader_conformance_summary.csv) runs over the
files of a corpus: files = number of rows; gate_pass = rows with gate_pass; max_max_rel and max_max_rel_channel = maximum of
max_rel and of max_rel_channel over the rows that have one; channels_compared = sum of n_compared; n_zero_ref_channels and
n_mne_warnings = sums over the rows; onsets_ok and onsets_ok_wo_first_new_segment = rows with onset_max_diff, respectively
onset_max_diff_wo_first_new_segment, at most tol_onset_s; files_single_rate and files_edf_d = rows with single_rate, respectively edf_d.
The manifest records the config as written, the commit and SHA-256 of the ddalab binary, library versions
and the SHA-256 of every input file the Rust reader names (primary and sidecars).

CSV columns (blank when the value does not exist, for example after a reader failure):
  corpus, file          corpus label and path of the recording
  format                Rust format from the inspection
  single_rate, edf_d    as above
  n_analysis            C
  n_compared            C if the sample comparison ran, otherwise 0
  n_stim                channels compared as x_mne * gain + offset
  n_zero_ref_channels   channels with max_ref_c = 0
  rate_hz, rate_mne_hz  f and f_mne
  samples, samples_mne  N and N_mne
  labels_equal, rate_equal, count_equal, max_abs, max_ref, max_rel, max_rel_channel, onset_max_diff,
  onset_max_diff_wo_first_new_segment, gate_pass    as above
  n_annotations         len(a_rust) before any removal
  n_annotations_mne     len(a_mne)
  n_mne_warnings        Python warnings raised while the file was processed (MNE runs at mne_log_level, where it emits its
                        warnings; the script records them and filters none)
  notes                 failures of ddalab inspect, ddalab samples (with the Rust stderr text) and the MNE reader, then the distinct
                        warning messages

Corpora: ds003029 (every .vhdr), mgh, cdr (cdr_file), mne_testing (EDF, BDF and BrainVision files of mne.datasets.testing).
MGH selection: the folders matching mgh_patient_glob are taken in sorted name order. In a folder the EDFs matching any of mgh_edf_globs
are sorted by full path and the first is kept: `*_Seizures*/*.edf` matches a subfolder with _Seizures in its name (MG07 has
MG07_Seizures_Tasks), `*Seizure*.edf` matches loose files in the folder (MG08 has such files). Folders without a match are
skipped. The first mgh_patients folders with a match give the files.

Paths in the config start with $SCRATCH, the data root of the machine that runs the script, and the outputs write them
the same way: the root stays out of the recorded files.

Command (on the machine that holds the recordings):
  SCRATCH=<data root> OMP_NUM_THREADS=1 nice -n 19 venv/bin/python reader_conformance.py reader_conformance_config.json reader_conformance.csv
Input: the config JSON and the recordings it names. Output: the CSV, reader_conformance_summary.csv and
reader_conformance_manifest.json beside it.
"""
import csv, glob, hashlib, json, multiprocessing, os, subprocess, sys, tempfile, warnings
import mne, numpy as np

SCRATCH = os.environ["SCRATCH"]
raw = json.load(open(sys.argv[1]))
cfg = json.loads(json.dumps(raw).replace("$SCRATCH", SCRATCH))
shown = lambda value: value.replace(SCRATCH, "$SCRATCH") if isinstance(value, str) else value
out = sys.argv[2]
mne.set_log_level(cfg["mne_log_level"])
READERS = {"edf": mne.io.read_raw_edf, "bdf": mne.io.read_raw_bdf, "vhdr": mne.io.read_raw_brainvision}
FIELDS = ["corpus", "file", "format", "single_rate", "edf_d", "n_analysis", "n_compared", "n_stim", "n_zero_ref_channels", "rate_hz",
          "rate_mne_hz", "samples", "samples_mne", "labels_equal", "rate_equal", "count_equal", "max_abs", "max_ref", "max_rel",
          "max_rel_channel", "n_annotations", "n_annotations_mne", "onset_max_diff", "onset_max_diff_wo_first_new_segment",
          "n_mne_warnings", "gate_pass", "notes"]
SUMMARY = ["corpus", "files", "gate_pass", "max_max_rel", "max_max_rel_channel", "channels_compared", "n_zero_ref_channels",
           "onsets_ok", "onsets_ok_wo_first_new_segment", "files_single_rate", "files_edf_d", "n_mne_warnings"]


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def header(path):
    """(single_rate, edf_d) of an EDF/BDF header."""
    with open(path, "rb") as f:
        h = f.read(256)
        ns = int(h[252:256])
        sig = f.read(256 * ns)
    label = [sig[16 * i:16 * i + 16].decode("latin1").strip() for i in range(ns)]
    spr = {sig[216 * ns + 8 * i:216 * ns + 8 * i + 8] for i in range(ns) if label[i] not in ("EDF Annotations", "BDF Annotations")}
    return len(spr) <= 1, h[192:197] in (b"EDF+D", b"BDF+D")


def onset_diff(a, b):
    return np.abs(np.sort(a) - np.sort(b)).max(initial=0.0) if len(a) == len(b) else np.nan


def compare(job):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        row, hashes = compare_file(job)
    msgs = list(dict.fromkeys(" ".join(str(w.message).split()) for w in caught))
    note = "mne warnings: " + " | ".join(msgs) if msgs else ""
    row.update(n_mne_warnings=len(caught), notes="; ".join(filter(None, [row["notes"], note])))
    return row, hashes


def compare_file(job):
    corpus, path = job
    row, notes = dict.fromkeys(FIELDS, ""), []
    ext = path.lower().rsplit(".", 1)[1]
    row.update(corpus=corpus, file=path, gate_pass=False)
    row["single_rate"], row["edf_d"] = header(path) if ext in ("edf", "bdf") else (True, False)
    inputs = [path]
    r = subprocess.run([cfg["ddalab"], "inspect", "--file", path, "--json"], capture_output=True, text=True)
    info = json.loads(r.stdout) if r.returncode == 0 else None
    if info is None:
        notes.append("ddalab inspect: " + r.stderr.strip())
    else:
        inputs = [os.path.join(os.path.dirname(path), f) for f in info["input_files"]]
    try:
        raw = READERS[ext](path, preload=False)
        row.update(rate_mne_hz=raw.info["sfreq"], samples_mne=raw.n_times)
    except Exception as e:
        raw = None
        notes.append(f"mne {type(e).__name__}: {e}")
    if info and raw:
        ch, A, f, N = info["channels"], info["analysis_channels"], info["sample_rate_hz"], info["sample_count"]
        names = [ch[i]["label"] for i in A]
        row.update(format=info["format"], n_analysis=len(A), n_compared=0, rate_hz=f, samples=N)
        row["labels_equal"] = [c["label"] for c in ch if c["kind"] != "Annotation"] == raw.ch_names
        row["rate_equal"], row["count_equal"] = f == raw.info["sfreq"], N == raw.n_times
        K, x_rust, x_mne = cfg["n_segments"], [], []
        if row["rate_equal"] and row["count_equal"] and N and A and set(names) <= set(raw.ch_names):
            n = min(round(cfg["segment_s"] * f), N)
            with tempfile.TemporaryDirectory(dir=cfg["scratch_dir"]) as tmp:
                for k in range(K):
                    s = k * (N - n) // (K - 1)
                    cmd = [cfg["ddalab"], "samples", "--file", path, "--channels", *map(str, range(len(A))),
                           "--start-sample", str(s), "--count", str(n), "--output", f"{tmp}/x.npy"]
                    r = subprocess.run(cmd, capture_output=True, text=True)
                    if r.returncode:
                        notes.append(f"ddalab samples (start {s}): " + r.stderr.strip())
                        break
                    x_rust.append(np.load(f"{tmp}/x.npy").T)
                    x_mne.append(raw.get_data(picks=names, start=s, stop=s + n))
        if len(x_rust) == K:
            x_rust, x_mne = np.hstack(x_rust), np.hstack(x_mne)
            stim = np.array([t == "stim" for t in raw.get_channel_types(picks=names)])[:, None]
            gain, offset = (np.array([ch[i][key] for i in A])[:, None] for key in ("gain", "offset"))
            x_mne = np.where(stim, x_mne * gain + offset, x_mne)
            max_abs_c, max_ref_c = np.abs(x_rust - x_mne).max(axis=1), np.abs(x_mne).max(axis=1)
            zero = max_ref_c == 0
            rel_c = np.where(zero, np.where(max_abs_c == 0, 0.0, np.inf), max_abs_c / np.where(zero, 1.0, max_ref_c))
            max_abs, max_ref = max_abs_c.max(), max_ref_c.max()
            max_rel = max_abs / max_ref if max_ref else (0.0 if max_abs == 0 else np.inf)
            row.update(n_compared=len(A), n_stim=int(stim.sum()), n_zero_ref_channels=int(zero.sum()), max_abs=max_abs,
                       max_ref=max_ref, max_rel=max_rel, max_rel_channel=rel_c.max())
        ann = [a for a in info["annotations"] if a["source"] != "events.tsv"]
        first = next((i for i, a in enumerate(ann) if a["label"] == "New Segment"), None)
        onsets, kept = [a["onset_s"] for a in ann], [a["onset_s"] for i, a in enumerate(ann) if i != first]
        a_mne = raw.annotations.onset - (raw.first_time if raw.annotations.orig_time is not None else 0)
        row.update(n_annotations=len(onsets), n_annotations_mne=len(a_mne), onset_max_diff=onset_diff(onsets, a_mne),
                   onset_max_diff_wo_first_new_segment=onset_diff(kept, a_mne))
        row["gate_pass"] = bool(row["labels_equal"] and row["rate_equal"] and row["count_equal"] and row["n_compared"] == len(A)
                                and (len(A) == 0 or row["max_rel_channel"] <= cfg["tol_rel"]))
    row["notes"] = "; ".join(notes)
    return row, {p: sha256(p) for p in inputs if os.path.isfile(p)}


if __name__ == "__main__":
    testing = mne.datasets.testing.data_path(path=cfg["mne_data_dir"], update_path=False, download=False)
    mgh = []
    for d in sorted(glob.glob(cfg["mgh_patient_glob"])):
        seizures = sorted({p for g in cfg["mgh_edf_globs"] for p in glob.glob(f"{d}/{g}")})
        mgh += seizures[:1]
    jobs = [("ds003029", p) for p in sorted(glob.glob(cfg["ds003029_glob"], recursive=True))]
    jobs += [("mgh", p) for p in mgh[:cfg["mgh_patients"]]] + [("cdr", cfg["cdr_file"])]
    jobs += [("mne_testing", p) for p in sorted(glob.glob(f"{testing}/**", recursive=True)) if p.lower().endswith(tuple(cfg["mne_testing_suffixes"]))]
    with multiprocessing.Pool(cfg["workers"]) as pool:
        results = pool.map(compare, jobs, chunksize=1)
    rows = [{k: shown(v) for k, v in r.items()} for r, _ in results]
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, FIELDS)
        w.writeheader()
        w.writerows(rows)
    manifest = {"config": raw, "config_sha256": sha256(sys.argv[1]), "command": sys.argv, "ddalab_commit": cfg["ddalab_commit"],
                "ddalab_sha256": sha256(cfg["ddalab"]), "mne": mne.__version__, "numpy": np.__version__,
                "python": sys.version.split()[0], "mne_testing_version": open(f"{testing}/version.txt").read().strip(),
                "input_sha256": {shown(p): h for _, hashes in results for p, h in hashes.items()}}
    json.dump(manifest, open(os.path.splitext(out)[0] + "_manifest.json", "w"), indent=2)
    tol, summary = cfg["tol_onset_s"], []
    for c in dict.fromkeys(r["corpus"] for r in rows):
        sub = [r for r in rows if r["corpus"] == c]
        top = lambda key: max((r[key] for r in sub if r[key] != ""), default="")
        ok = lambda key: sum(r[key] != "" and r[key] <= tol for r in sub)
        total = lambda key: sum(r[key] or 0 for r in sub)
        summary.append(dict(zip(SUMMARY, [c, len(sub), sum(r["gate_pass"] is True for r in sub), top("max_rel"), top("max_rel_channel"),
                                          total("n_compared"), total("n_zero_ref_channels"), ok("onset_max_diff"),
                                          ok("onset_max_diff_wo_first_new_segment"), sum(r["single_rate"] is True for r in sub),
                                          sum(r["edf_d"] is True for r in sub), total("n_mne_warnings")])))
    with open(os.path.splitext(out)[0] + "_summary.csv", "w", newline="") as f:
        w = csv.DictWriter(f, SUMMARY)
        w.writeheader()
        w.writerows(summary)
    for r in summary:
        print(*(f"{k}={v}" for k, v in r.items()))
