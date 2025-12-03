---
sidebar_position: 2
---

# Quick Start

Get up and running with DDALAB in minutes.

## Loading Your First File

1. Launch DDALAB
2. Click **File > Open** or use `Cmd/Ctrl + O`
3. Select an EDF, BrainVision, or other supported file
4. The file loads and displays in the File Manager

## Interface Overview

### Main Panels

- **Navigation** (Left): File browser and recent files
- **Main View** (Center): Data visualization and analysis
- **Configuration** (Right): Settings and parameters

### Key Areas

```
┌─────────────────────────────────────────────────────────────┐
│  Navigation  │           Main View           │  Settings   │
│              │                               │             │
│  Files       │   Time Series Visualization   │  DDA Config │
│  Browser     │                               │             │
│              │   Analysis Results            │  Channel    │
│  Recent      │                               │  Selection  │
│  Files       │                               │             │
└─────────────────────────────────────────────────────────────┘
```

## Basic Workflow

### 1. Load Data

Open a file using the file browser or drag-and-drop.

### 2. Preview Data

View the time series in the visualization panel:

- Scroll to navigate through time
- Zoom with mouse wheel
- Select channels to display

### 3. Configure Analysis

In the DDA Configuration panel:

- Set embedding dimension (m)
- Configure time delay (τ)
- Select delta range
- Choose channels to analyze

### 4. Run Analysis

Click **Run Analysis** to start DDA computation.

### 5. View Results

Results appear in the DDA Results panel showing:

- Computed values per channel
- Statistical summaries
- Visualization of results

### 6. Export

Export results via **File > Export** in formats:

- CSV
- JSON
- MATLAB (.mat)

## Keyboard Shortcuts

| Action      | macOS            | Windows/Linux |
| ----------- | ---------------- | ------------- |
| Open File   | `Cmd + O`        | `Ctrl + O`    |
| Save        | `Cmd + S`        | `Ctrl + S`    |
| Settings    | `Cmd + ,`        | `Ctrl + ,`    |
| Full Screen | `Cmd + Ctrl + F` | `F11`         |
| Zoom In     | `Cmd + +`        | `Ctrl + +`    |
| Zoom Out    | `Cmd + -`        | `Ctrl + -`    |

## Next Steps

- [First Analysis](./first-analysis) - Detailed analysis tutorial
- [File Formats](../user-guide/file-formats) - Supported formats reference
- [DDA Analysis Guide](../user-guide/dda-analysis) - In-depth analysis guide
