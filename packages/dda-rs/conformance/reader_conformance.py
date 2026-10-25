"""Do the Rust readers (ddalab) return the samples, labels, rate, length and annotation onsets of MNE?

For each recording, with Rust values from `ddalab inspect --json` and `ddalab samples`, and MNE values from
`read_raw_edf`, `read_raw_bdf` or `read_raw_brainvision` (preload=False) and `raw.get_data` (SI units):

  A        = analysis_channels of the Rust inspection (Signal channels at the recording rate), C = |A|
  f, N     = Rust sample_rate_hz and sample_count;   f_mne = raw.info['sfreq'], N_mne = raw.n_times
  n        = min(round(segment_s * f), N);   s_k = k * (N - n) // (K - 1), k = 0..K-1   (K = n_segments: start, middle, end)
  x_rust_k = ddalab samples, channels A, samples s_k .. s_k + n - 1, shape (C, n)
  x_mne_k  = raw.get_data(picks = labels of A, start = s_k, stop = s_k + n), shape (C, n); MNE returns the unscaled digital
             values of a channel it types stim, so there x_mne_k is replaced by x_mne_k * gain + offset (Rust's gain and offset):
             decoding is compared, calibration is not. n_stim counts these channels.
  max_abs  = max over k, channels, samples of |x_rust - x_mne|
  max_ref  = max over k, channels, samples of |x_mne|
  max_rel  = max_abs / max_ref   (0 if max_abs = 0 = max_ref)
  labels_equal = [label of Rust channels with kind != Annotation] == raw.ch_names
  rate_equal = (f == f_mne);  count_equal = (N == N_mne)
  onset_max_diff = max |sort(onset_s of Rust annotations, source != events.tsv) - sort(raw.annotations.onset - first_time)|
                   over the annotations; nan if the counts differ. onset_max_diff_wo_first_new_segment is the same with the first Rust
                   annotation labelled "New Segment" removed (MNE turns the first BrainVision marker of that type into meas_date).
  gate_pass = labels_equal and rate_equal and count_equal and all C channels compared and (C == 0 or max_rel <= tol_rel)
  single_rate, edf_d = read from the EDF/BDF header (samples per record of all non-annotation signals are equal; reserved field
                   starts with EDF+D or BDF+D), independent of both readers. MNE resamples mixed-rate EDF and concatenates EDF+D
                   records, so such files cannot be compared sample by sample and are listed as deviating. For a mixed-rate
                   file whose MNE rate equals f the channels at f are compared (MNE resamples only the slower ones).

Every aggregate runs over one file: its C channels and K segments. The final summary prints, per corpus, the files, the
gate_pass count, the maximum of max_rel over the files and the number of files with onset_max_diff (and without the first New Segment)
at most tol_onset_s. The manifest records the resolved config, the commit and SHA-256 of the ddalab binary, library versions
and the SHA-256 of every input file the Rust reader names (primary and sidecars).

Corpora: ds003029 (every .vhdr), mgh (first seizure EDF of each of the first mgh_patients patients by sorted folder name),
cdr (cdr_file), mne_testing (EDF, BDF and BrainVision files of mne.datasets.testing).

Command (on node32):
  OMP_NUM_THREADS=1 nice -n 19 venv/bin/python reader_conformance.py reader_conformance_config.json reader_conformance.csv
Input: the config JSON and the recordings it names. Output: the CSV and reader_conformance_manifest.json beside it.
"""
import csv, glob, hashlib, json, multiprocessing, os, subprocess, sys, tempfile, warnings
import mne, numpy as np

warnings.simplefilter("ignore")
cfg = json.load(open(sys.argv[1]))
out = sys.argv[2]
READERS = {"edf": mne.io.read_raw_edf, "bdf": mne.io.read_raw_bdf, "vhdr": mne.io.read_raw_brainvision}
FIELDS = ["corpus", "file", "format", "single_rate", "edf_d", "n_analysis", "n_compared", "n_stim", "rate_hz", "rate_mne_hz",
          "samples", "samples_mne", "labels_equal", "rate_equal", "count_equal", "max_abs", "max_ref", "max_rel", "n_annotations",
          "n_annotations_mne", "onset_max_diff", "onset_max_diff_wo_first_new_segment", "gate_pass", "notes"]


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
        raw = READERS[ext](path, preload=False, verbose="ERROR")
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
        if row["rate_equal"] and row["count_equal"] and N and set(names) <= set(raw.ch_names):
            n, K, x_rust, x_mne = min(round(cfg["segment_s"] * f), N), cfg["n_segments"], [], []
            with tempfile.TemporaryDirectory(dir=cfg["scratch_dir"]) as tmp:
                for k in range(K):
                    s = k * (N - n) // (K - 1)
                    cmd = [cfg["ddalab"], "samples", "--file", path, "--channels", *map(str, range(len(A))),
                           "--start-sample", str(s), "--count", str(n), "--output", f"{tmp}/x.npy"]
                    subprocess.run(cmd, check=True, capture_output=True)
                    x_rust.append(np.load(f"{tmp}/x.npy").T)
                    x_mne.append(raw.get_data(picks=names, start=s, stop=s + n))
            x_rust, x_mne = np.hstack(x_rust), np.hstack(x_mne)
            stim = np.array([t == "stim" for t in raw.get_channel_types(picks=names)])[:, None]
            gain, offset = (np.array([ch[i][key] for i in A])[:, None] for key in ("gain", "offset"))
            x_mne = np.where(stim, x_mne * gain + offset, x_mne)
            max_abs, max_ref = np.abs(x_rust - x_mne).max(), np.abs(x_mne).max()
            max_rel = max_abs / max_ref if max_ref else (0.0 if max_abs == 0 else np.inf)
            row.update(n_compared=len(A), n_stim=int(stim.sum()), max_abs=max_abs, max_ref=max_ref, max_rel=max_rel)
        ann = [a for a in info["annotations"] if a["source"] != "events.tsv"]
        first = next((i for i, a in enumerate(ann) if a["label"] == "New Segment"), None)
        onsets, kept = [a["onset_s"] for a in ann], [a["onset_s"] for i, a in enumerate(ann) if i != first]
        a_mne = raw.annotations.onset - (raw.first_time if raw.annotations.orig_time is not None else 0)
        row.update(n_annotations=len(onsets), n_annotations_mne=len(a_mne), onset_max_diff=onset_diff(onsets, a_mne),
                   onset_max_diff_wo_first_new_segment=onset_diff(kept, a_mne))
        row["gate_pass"] = bool(row["labels_equal"] and row["rate_equal"] and row["count_equal"] and row["n_compared"] == len(A)
                                and (len(A) == 0 or row["max_rel"] <= cfg["tol_rel"]))
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
    rows = [r for r, _ in results]
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, FIELDS)
        w.writeheader()
        w.writerows(rows)
    manifest = {"config": cfg, "config_sha256": sha256(sys.argv[1]), "command": sys.argv, "ddalab_commit": cfg["ddalab_commit"],
                "ddalab_sha256": sha256(cfg["ddalab"]), "mne": mne.__version__, "numpy": np.__version__,
                "python": sys.version.split()[0], "mne_testing_version": open(f"{testing}/version.txt").read().strip(),
                "input_sha256": {p: h for _, hashes in results for p, h in hashes.items()}}
    json.dump(manifest, open(os.path.splitext(out)[0] + "_manifest.json", "w"), indent=2)
    tol = cfg["tol_onset_s"]
    for c in dict.fromkeys(r["corpus"] for r in rows):
        sub = [r for r in rows if r["corpus"] == c]
        rel = [r["max_rel"] for r in sub if r["max_rel"] != ""]
        print(c, "files", len(sub), "gate_pass", sum(r["gate_pass"] is True for r in sub), "max_max_rel", max(rel, default=""),
              "onsets_ok", sum(r["onset_max_diff"] != "" and r["onset_max_diff"] <= tol for r in sub),
              "onsets_ok_wo_first_new_segment", sum(r["onset_max_diff_wo_first_new_segment"] != "" and r["onset_max_diff_wo_first_new_segment"] <= tol for r in sub))
