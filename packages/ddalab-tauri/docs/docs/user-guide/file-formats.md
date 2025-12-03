---
sidebar_position: 2
---

# Supported File Formats

DDALAB supports a wide range of neurophysiology file formats.

## Default Formats

These formats are always available:

### EDF/EDF+ (.edf)

European Data Format, the standard for clinical EEG.

| Feature         | Support       |
| --------------- | ------------- |
| Read            | ✅ Full       |
| Write           | ✅ Full       |
| Annotations     | ✅ EDF+       |
| Physical values | ✅ Calibrated |

**Usage:**

```
File > Open > Select .edf file
```

### BrainVision (.vhdr, .vmrk, .eeg)

BrainProducts format with separate header, marker, and data files.

| Feature      | Support |
| ------------ | ------- |
| Read         | ✅ Full |
| Write        | ❌      |
| Markers      | ✅ Full |
| Binary/ASCII | ✅ Both |

**Note:** All three files (.vhdr, .vmrk, .eeg) must be in the same directory.

### EEGLAB (.set)

MATLAB-based EEGLAB format.

| Feature     | Support    |
| ----------- | ---------- |
| Read        | ✅ Full    |
| Write       | ❌         |
| Events      | ✅ Full    |
| ICA weights | ⚠️ Partial |

### FIF/FIFF (.fif)

Neuromag/Elekta MEG format.

| Feature  | Support |
| -------- | ------- |
| Read     | ✅ Full |
| Write    | ❌      |
| MEG data | ✅ Full |
| EEG data | ✅ Full |

### XDF (.xdf)

Lab Streaming Layer format for multi-stream recordings.

| Feature      | Support         |
| ------------ | --------------- |
| Read         | ✅ Full         |
| Write        | ✅ Full         |
| Multi-stream | ✅ Full         |
| Timestamps   | ✅ Synchronized |

### NIfTI (.nii, .nii.gz)

Neuroimaging format.

| Feature     | Support        |
| ----------- | -------------- |
| Read        | ✅ Full        |
| Write       | ❌             |
| 4D volumes  | ✅ Time series |
| Compression | ✅ gzip        |

### CSV/ASCII (.csv, .txt)

Generic text-based formats.

| Feature   | Support         |
| --------- | --------------- |
| Read      | ✅ Full         |
| Write     | ✅ Full         |
| Delimiter | ✅ Configurable |
| Header    | ✅ Optional     |

## Optional Formats

These formats require feature flags during build:

### NWB (.nwb)

Neurodata Without Borders format.

**Requires:** `--features nwb-support`

| Feature           | Support |
| ----------------- | ------- |
| Read              | ✅ Full |
| Write             | ✅ Full |
| HDF5              | ✅ 2.x  |
| Electrical series | ✅ Full |

**Enable during build:**

```bash
cargo build --features nwb-support
```

## Format Detection

DDALAB automatically detects file format based on:

1. File extension
2. File header/magic bytes
3. Internal structure

## Format Conversion

Convert between formats using the export feature:

1. Load source file
2. Go to **File > Export As**
3. Select target format
4. Configure options
5. Save

### Supported Conversions

| From | To    |
| ---- | ----- |
| Any  | CSV   |
| Any  | EDF   |
| Any  | XDF   |
| Any  | ASCII |

## Troubleshooting

### File Won't Open

- Verify file extension matches content
- Check file isn't corrupted
- Ensure all companion files present (e.g., .vmrk for BrainVision)

### Missing Channels

- Check channel selection in import dialog
- Verify channel names in source file

### Wrong Values

- Check physical/digital calibration
- Verify unit conversion settings
