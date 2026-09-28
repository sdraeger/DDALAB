# DDALAB Scripts

Run these from the repository root.

- `build-and-release.sh`: starts the `release-desktop.yml` GitHub Actions workflow, which builds the macOS, Windows, and Linux installers and publishes the release.
- `sync-packages.sh`: syncs the dda-py and DelayDifferentialAnalysis.jl packages to their own repositories (`--python`, `--julia`, `--push`, `--tag VERSION`).
