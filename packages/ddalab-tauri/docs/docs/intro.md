---
sidebar_position: 1
slug: /
---

# DDALAB Documentation

Welcome to **DDALAB** (Delay Differential Analysis Laboratory), a scientific computing application for performing Delay Differential Analysis on neurophysiology data.

## What is DDALAB?

DDALAB is a cross-platform desktop application that enables researchers to:

- **Load neurophysiology data** from multiple file formats (EDF, BrainVision, XDF, NWB, and more)
- **Perform DDA analysis** with configurable parameters
- **Visualize results** with interactive time series plots
- **Export data** to various formats for further analysis

## Key Features

### Multi-format File Support

DDALAB supports a wide range of neurophysiology file formats:

| Format      | Extension | Description                                  |
| ----------- | --------- | -------------------------------------------- |
| EDF/EDF+    | `.edf`    | European Data Format (clinical EEG standard) |
| BrainVision | `.vhdr`   | BrainProducts format                         |
| EEGLAB      | `.set`    | MATLAB-based EEGLAB format                   |
| FIF/FIFF    | `.fif`    | Neuromag/Elekta MEG format                   |
| XDF         | `.xdf`    | Lab Streaming Layer format                   |
| NWB         | `.nwb`    | Neurodata Without Borders (optional)         |

### Built-in DDA Analysis

Configure and run Delay Differential Analysis with:

- Adjustable embedding dimension (m)
- Configurable time delay (τ)
- Customizable delta range
- Channel selection and preprocessing options

### Real-time Visualization

- Interactive time series plots
- Channel overlay and comparison
- Zoom and pan navigation
- Export visualizations as images

## Architecture

DDALAB is built with modern technologies:

- **Frontend**: React 19 + Next.js 16 with Tailwind CSS
- **Backend**: Rust with Tauri v2
- **Analysis**: Native DDA implementation in Rust
- **UI Components**: Radix UI primitives with shadcn/ui design system

## Getting Started

Ready to dive in? Check out our [Installation Guide](./getting-started/installation) to get started, or jump straight to the [Quick Start](./getting-started/quick-start) tutorial.

## Documentation Sections

- **[Getting Started](./getting-started/installation)** - Installation and first steps
- **[User Guide](./user-guide/overview)** - Detailed feature documentation
- **[API Reference](./api/overview)** - TypeScript and Rust API documentation
- **[Components](./components/overview)** - UI component library
- **[Development](./development/architecture)** - Architecture and contributing guidelines
