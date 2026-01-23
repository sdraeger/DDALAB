# DDALAB Future Feature Roadmap

> Generated: 2025-11-28
> Status: Strategic Planning Document

---

## Executive Summary

DDALAB occupies a unique position: a **modern, cross-platform desktop application** with a Rust backend and React/Tauri frontend, designed around **Delay Differential Analysis** - a novel technique for analyzing nonlinear dynamics in neurophysiology data. Unlike EEGLAB (MATLAB-based, 20+ years old), DDALAB can leverage modern architecture patterns while integrating DDA as a first-class citizen.

---

## 1. Core Analysis Pipeline (EEGLAB Parity)

### 1.1 Preprocessing Pipeline (High Priority)
**Current State:** Types defined in `persistence.ts`, basic filtering in frontend
**Gap:** No unified preprocessing pipeline

| Feature | Implementation Notes |
|---------|---------------------|
| **Artifact Rejection** | Automatic bad channel/epoch detection using variance thresholds |
| **ICA Artifact Removal** | Backend ICA exists (`ica/processor.rs`), needs UI for component rejection |
| **Re-referencing** | Average, linked mastoid, Laplacian, custom reference schemes |
| **Baseline Correction** | Pre-stimulus baseline removal |
| **Filtering** | Move to Rust backend for performance (FIR/IIR, zero-phase) |
| **Interpolation** | Spherical spline for bad channel interpolation |

**Target Pipeline:**
```
Raw Data → Bad Channel Detection → Filtering → Re-reference → ICA → Artifact Removal → DDA-Ready
```

### 1.2 Event/Marker System (Medium Priority)
**Current State:** Annotations exist but are time-point only
**Gap:** No event-locked analysis, epochs

| Feature | Notes |
|---------|-------|
| **Event Codes** | Import from EDF+, BrainVision markers, XDF streams |
| **Epoch Extraction** | Time-lock to events with pre/post windows |
| **Epoch Averaging** | ERPs with baseline correction |
| **Event-Locked DDA** | Run DDA on epoched data, compare conditions |
| **Condition Manager** | Define experimental conditions from event patterns |

### 1.3 Channel Operations
**Current State:** Channel selection only
**Gap:** No spatial filtering or montage support

| Feature | Notes |
|---------|-------|
| **Montage Editor** | Bipolar, Laplacian, custom derivations |
| **Channel Groups** | Save/load channel configurations |
| **Electrode Localization** | 2D/3D head plots with standard layouts |
| **Spatial Filtering** | Current Source Density (CSD), Surface Laplacian |

---

## 2. DDA-Specific Innovations (Differentiators)

### 2.1 DDA Parameter Optimization (High Priority)
**Current State:** Manual parameter selection
**Opportunity:** Automated optimal parameter discovery

| Feature | Notes |
|---------|-------|
| **Sensitivity Analysis** | Systematic lag/dimension sweeps (UI exists: `SensitivityAnalysisDialog.tsx`) |
| **Information-Theoretic Selection** | Use mutual information for optimal delay |
| **Cross-Validation** | Split-half reliability metrics |
| **Parameter Recommendations** | ML-based suggestions from data characteristics |

### 2.2 Advanced DDA Visualizations (Medium Priority)
**Current State:** Heatmaps and line plots
**Opportunity:** Novel visualization modalities

| Feature | Notes |
|---------|-------|
| **Phase Space Portraits** | 3D delay embedding visualization |
| **Network Motif Analysis** | Component exists (`NetworkMotifPlot.tsx`), needs expansion |
| **Temporal Evolution** | Animated DDA dynamics over time |
| **Connectivity Matrices** | Cross-derivative causality visualization |
| **Topographic DDA Maps** | Project DDA metrics onto scalp topology |

### 2.3 Real-Time DDA (Streaming) (High Priority)
**Current State:** Backend infrastructure complete (`streaming/` module)
**Gap:** Limited UI, no closed-loop capabilities

| Feature | Notes |
|---------|-------|
| **LSL Integration** | Discovery works (`LslStreamDiscovery.tsx`), needs streaming DDA |
| **Neurofeedback** | Real-time DDA feedback protocols |
| **BCI Pipelines** | Online classification using DDA features |
| **Latency Optimization** | Sub-100ms DDA computation |
| **Adaptive Parameters** | Dynamic window sizing based on signal stationarity |

---

## 3. Multi-Subject & Group Analysis

### 3.1 Batch Processing (High Priority)
**Current State:** Single-file analysis
**Gap:** No batch or group-level analysis

| Feature | Notes |
|---------|-------|
| **BIDS Integration** | Already started (`BIDSBrowser.tsx`), extend for batch |
| **Batch DDA** | Run identical parameters across datasets |
| **Progress Tracking** | Queue management with status |
| **Result Aggregation** | Combine results for group statistics |
| **Parallel Execution** | Multi-file concurrent processing |

### 3.2 Statistical Analysis (Medium Priority)
**Current State:** No statistics
**Gap:** Critical for publication-ready results

| Feature | Notes |
|---------|-------|
| **Group Comparisons** | t-tests, ANOVA on DDA metrics |
| **Permutation Testing** | Non-parametric significance |
| **Multiple Comparisons** | FDR, Bonferroni corrections |
| **Effect Sizes** | Cohen's d, confidence intervals |
| **Export for R/Python** | Statistical packages integration |

### 3.3 Machine Learning Integration (Medium Priority)
**Current State:** None
**Opportunity:** DDA features for classification

| Feature | Notes |
|---------|-------|
| **Feature Extraction** | DDA metrics as ML features |
| **Classification** | SVM, Random Forest on DDA features |
| **Cross-Validation** | K-fold, leave-one-out |
| **Model Export** | ONNX/PMML for deployment |

---

## 4. Collaboration & Reproducibility

### 4.1 Sync Infrastructure (High Priority)
**Current State:** Backend complete (`sync/` module), UI pending
**Gap:** No UI for collaboration

| Feature | Notes |
|---------|-------|
| **Result Sharing** | Share DDA results with collaborators |
| **Annotation Sync** | Real-time collaborative annotation |
| **Protocol Templates** | Share analysis configurations |
| **Version History** | Track analysis parameter changes |

### 4.2 Reproducibility (Medium Priority)
**Current State:** Code generation stubs exist (`recording/codegen.rs`)
**Gap:** Incomplete implementation

| Feature | Notes |
|---------|-------|
| **Analysis Recording** | Auto-capture all operations |
| **Python Export** | Generate MNE-Python equivalent code |
| **Julia Export** | Generate Julia analysis scripts |
| **MATLAB Export** | EEGLAB-compatible scripts |
| **Provenance Tracking** | Full lineage from raw to results |

### 4.3 Reporting (Low Priority)
**Current State:** Manual export
**Gap:** No automated reporting

| Feature | Notes |
|---------|-------|
| **PDF Reports** | Publication-ready figures + stats |
| **HTML Dashboards** | Interactive result exploration |
| **Jupyter Notebooks** | Export as notebook for sharing |

---

## 5. Cloud & HPC Integration

### 5.1 NSG Enhancement (Medium Priority)
**Current State:** Basic NSG client (`nsg/` module)
**Gap:** Limited resource configuration, no result visualization

| Feature | Notes |
|---------|-------|
| **Resource Optimization** | Auto-select optimal HPC resources |
| **Job Monitoring** | Real-time progress from NSG |
| **Result Streaming** | Progressive result loading |
| **Cost Estimation** | Predict compute credits needed |

### 5.2 Cloud DDA Service (Future)
**Current State:** Local-only processing
**Opportunity:** Serverless DDA

| Feature | Notes |
|---------|-------|
| **AWS/GCP Functions** | Serverless DDA processing |
| **Data Residency** | Regional processing for privacy |
| **Elastic Scaling** | Handle large batch jobs |

---

## 6. Format & Interoperability

### 6.1 Additional File Formats (Medium Priority)
**Current State:** EDF, CSV, ASCII, XDF, BrainVision, EEGLAB, FIF, NIfTI
**Gap:** MEG, some proprietary formats

| Format | Priority | Notes |
|--------|----------|-------|
| **MEG (CTF/KIT/BTi)** | High | Large user base |
| **Curry** | Medium | Clinical EEG |
| **Nihon Kohden** | Medium | Clinical EEG |
| **Persyst** | Low | ICU monitoring |
| **GDF** | Low | BioSig compatibility |

### 6.2 BIDS Full Compliance (High Priority)
**Current State:** Partial BIDS support
**Gap:** No BIDS export, incomplete metadata

| Feature | Notes |
|---------|-------|
| **BIDS Export** | Convert datasets to BIDS structure |
| **Derivatives** | Store DDA results as BIDS derivatives |
| **Metadata Validation** | BIDS validator integration |
| **Event Import** | Parse _events.tsv files |

---

## 7. Performance & Scalability

### 7.1 Large File Handling (High Priority)
**Current State:** Full file loading
**Gap:** Memory issues with 100GB+ files

| Feature | Notes |
|---------|-------|
| **Memory Mapping** | mmap for zero-copy access |
| **Lazy Loading** | Load only visible data |
| **Chunked DDA** | Process segments independently |
| **Progressive Results** | Stream partial results |

### 7.2 GPU Acceleration (Future)
**Current State:** CPU-only
**Opportunity:** Significant speedup for DDA

| Feature | Notes |
|---------|-------|
| **CUDA Backend** | GPU-accelerated DDA |
| **WebGPU Rendering** | Fast visualization |
| **Multi-GPU Support** | Parallel DDA computation |

---

## 8. Extension Ecosystem

### 8.1 Plugin Architecture (Future)
**Current State:** Monolithic
**Opportunity:** EEGLAB-style extensibility

| Feature | Notes |
|---------|-------|
| **Plugin API** | Documented extension points |
| **Custom Readers** | User-defined file formats |
| **Analysis Plugins** | Third-party analysis methods |
| **Visualization Plugins** | Custom plot types |
| **Plugin Manager** | Install/update from registry |

### 8.2 Scripting Interface (Future)
**Current State:** GUI-only
**Opportunity:** Automation

| Feature | Notes |
|---------|-------|
| **JavaScript API** | Script UI interactions |
| **Python Bridge** | Call DDALAB from Python |
| **CLI Mode** | Headless batch processing |

---

## Implementation Priority Matrix

| Priority | Category | Features |
|----------|----------|----------|
| **P0 (Now)** | Core | Preprocessing pipeline, batch processing, streaming DDA UI |
| **P1 (3-6 mo)** | Analysis | Group statistics, event-locked DDA, ICA artifact removal UI |
| **P2 (6-12 mo)** | Collaboration | Sync UI, reproducibility export, BIDS full compliance |
| **P3 (12+ mo)** | Scale | Plugin system, GPU acceleration, memory-mapped files |

---

## Competitive Positioning

| Feature | EEGLAB | MNE-Python | DDALAB |
|---------|--------|------------|--------|
| **Platform** | MATLAB | Python | Native Desktop |
| **DDA** | Plugin | None | First-class |
| **Real-time** | Limited | Basic | Full streaming |
| **Modern UI** | ❌ | ❌ | ✅ |
| **Offline-first** | ✅ | ✅ | ✅ |
| **Cloud HPC** | ❌ | ❌ | ✅ (NSG) |
| **Collaboration** | ❌ | ❌ | ✅ (Sync) |

DDALAB's unique value proposition: **DDA-native analysis with modern UX, real-time capabilities, and built-in collaboration** - none of which exist in EEGLAB or MNE-Python.

---

## Architecture Notes

### Preprocessing Pipeline Architecture

The preprocessing pipeline follows a modular, step-based design:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PreprocessingPipeline                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Step 1  │→ │  Step 2  │→ │  Step 3  │→ │  Step 4  │→ ...   │
│  │Bad Chan. │  │ Filtering│  │Re-ref    │  │   ICA    │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
├─────────────────────────────────────────────────────────────────┤
│  PreprocessingStore (Zustand)                                   │
│  - Pipeline configuration per file                              │
│  - Step enable/disable state                                    │
│  - Step parameters                                              │
│  - Processing status                                            │
├─────────────────────────────────────────────────────────────────┤
│  Backend Processing (Rust)                                      │
│  - Filter implementations (IIR, FIR)                            │
│  - ICA computation                                              │
│  - Bad channel detection                                        │
│  - Re-referencing                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Non-destructive**: Original data is never modified
2. **Reversible**: Each step can be toggled on/off
3. **Persistent**: Configuration saved per-file
4. **Previewable**: See effects before applying
5. **Exportable**: Save processed data to new file
