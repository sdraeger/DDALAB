# DDALAB GUI

`ddalab-gui` is the Qt desktop launcher package for DDALAB.

It is intentionally thin:

- the shared DDALAB runtime, local backend, dataset readers, and bundled native binaries live in `packages/ddalab-cli`
- this package provides the dedicated `ddalab-gui` entry point and the PyInstaller bundle shell

## Development

```bash
cd packages/ddalab-gui
./start.sh
```

The script provisions a local virtual environment, installs `packages/ddalab-cli` in editable mode, and launches the Qt application.

## Smoke Test

```bash
cd packages/ddalab-gui
./start.sh --smoke-test
```
