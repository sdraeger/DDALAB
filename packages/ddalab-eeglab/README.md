# DDALAB plugin for EEGLAB

Adds Tools > DDALAB to EEGLAB. Run DDA analyzes the current continuous dataset with the `ddalab` command-line program and stores its result document in `EEG.etc.dda`. Plot DDA result draws each variant over time, with the dataset's events as vertical lines. The plugin runs the same engine as the web app and the command line, so a result from EEGLAB equals the one `ddalab run` gives for the same data.

## Install

1. Install `ddalab` as the [main README](../../README.md#command-line) describes (`uv tool install ddalab`, or a release archive).
2. Copy this folder to `eeglab/plugins/ddalab/` and restart EEGLAB.

MATLAB sees only the PATH it was started with, and on macOS a MATLAB opened from the Dock does not see `~/.local/bin` or `/opt/homebrew/bin`. If Run DDA reports that `ddalab` failed, tell the plugin where the program is:

```matlab
setenv('DDALAB_CLI', '/Users/me/.local/bin/ddalab')   % e.g. in startup.m
```

## Scripting

```matlab
EEG = pop_dda(EEG, 'variants', {'ST', 'CT'}, 'ct_pairs', [1 2; 1 3], 'wl', 1000, 'ws', 200);
pop_ddaplot(EEG);
```

`help pop_dda` lists the keys. Channels and pairs count from 1, as in EEGLAB. CT needs `ct_pairs` and CD needs `cd_pairs`. Epoched datasets are refused; DDALAB analyzes continuous data.

## Test

The test saves a dataset with EEGLAB, runs `pop_dda` on it, and checks the stored result against `ddalab run` on the saved file:

```sh
matlab -batch "addpath('packages/ddalab-eeglab/test'); test_pop_dda('/path/to/eeglab', '/path/to/ddalab')"
```

On a Linux machine without a display, set `QT_QPA_PLATFORM=offscreen` first.
