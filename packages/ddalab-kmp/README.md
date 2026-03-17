# DDALAB KMP

Compose Multiplatform desktop-first port of `packages/ddalab-tauri`.

## What is implemented

- Kotlin Multiplatform project structure with shared Compose UI code.
- Desktop app shell modeled after the DDALAB Tauri experience:
  navigation, data browser, time-series workspace, DDA workspace, settings,
  notifications, and history.
- Custom Canvas-based waveform renderer with multiresolution min/max envelopes
  for large-signal viewing.
- Local file loading for CSV, ASCII/TXT, and EDF datasets.
- Real DDA execution through the existing Rust CLI/binary path when available,
  with a deterministic Kotlin preview fallback if the native engine fails.

## Run

```bash
cd packages/ddalab-kmp
./gradlew :composeApp:run
```

## Compile check

```bash
cd packages/ddalab-kmp
./gradlew :composeApp:compileKotlinDesktop
```

## Notes

- The app auto-detects the repository `data/` directory when launched from this
  monorepo.
- The Rust DDA engine is discovered through the repository's `bin/run_DDA_AsciiEdf`
  and `packages/dda-cli`.
- CSV and ASCII files are normalized into temporary numeric matrices before
  handing them to the native DDA engine, which makes headered tabular files work
  better than the legacy Tauri path.
