# ddalab

Delay differential analysis (DDA) of EEG, iEEG and other multichannel recordings, from
[DDALAB](https://github.com/sdraeger/DDALAB). One install gives the `ddalab` command line and the `ddalab` Python library,
which share one Rust engine.

```sh
pip install ddalab          # or: uv tool install ddalab, pipx install ddalab
uvx ddalab run --file recording.edf
```

```python
import ddalab

result = ddalab.run("sub-01_eeg.edf", variants=["ST", "CT"], wl=200, ws=100)
result.variants["ST"].q        # NumPy array, (channels, windows)
result.window_centers          # seconds
result.save("result.json")     # the document `ddalab run -o result.json` writes

recording = ddalab.read("sub-01_eeg.edf")   # data (channels, samples) in SI units, sfreq, ch_names, events
ddalab.run(recording.data, sfreq=recording.sfreq, ch_names=recording.ch_names)
ddalab.run(raw)                              # an MNE Raw
```

Parameters left out take the defaults of `ddalab run`; `ddalab run --help` describes each one. See the
[DDALAB README](https://github.com/sdraeger/DDALAB#readme) for the web app and the formats.
