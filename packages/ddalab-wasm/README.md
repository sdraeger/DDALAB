# ddalab-wasm

The engine of [DDALAB](https://github.com/sdraeger/DDALAB) (dda-rs: delay differential analysis of EEG, iEEG and other
multichannel recordings) as WebAssembly, with a Node host that reads EDF, BDF, BrainVision, EEGLAB and text recordings
from disk. The DDALAB web app runs the same module in the browser.

```sh
npm install ddalab-wasm
```

```js
import { load } from 'ddalab-wasm';

const engine = await load();
const { handle, info } = engine.open(['recording.edf']);
const { manifest, arrays } = engine.run(handle, {
  file_path: 'recording.edf',
  channels: [0, 1],
  time_range: { start: 0, end: info.sample_count - 1 },
  preprocessing_options: { highpass: null, lowpass: null },
  algorithm_selection: { enabled_variants: ['ST'], select_mask: '1 0 0 0 0 0' },
  window_parameters: { window_length: 200, window_step: 100 },
  delay_parameters: { delays: [7, 10] },
  model_parameters: { dm: 4, order: 4, nr_tau: 2 },
});
engine.close(handle);
manifest.window_centers_seconds; // seconds
arrays['ST/q.npy'];              // { shape: [windows, channels], data: Float64Array }
```

`manifest` is the document `ddalab run --bundle` writes and `arrays` hold its `.npy` arrays. The request is the one
`ddalab run` builds; `ddalab run --help` describes the parameters. Node 20 or later.
