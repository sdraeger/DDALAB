# DDALAB TODO

## v1.0.0 Release Status (January 2025)

### ✅ Completed for v1.0.0

1. **CSV/ASCII File Support** ✅

   - Full support for .csv, .ascii, and .txt time series files
   - Automatic header detection
   - Default channel naming ("Channel 1", "Channel 2", etc.) for headerless files
   - FileType enum for centralized file type detection
   - Race condition fix - no 500 errors when switching file types
   - Channel validation before chunk loading
   - Test files created (with and without headers)
   - DDA analysis remains EDF-only (as intended)

2. **UI Scrolling Fix** ✅

   - Proper overflow hierarchy in all tabs
   - Vertical scrollbars appear when window is too small
   - Each tab independently scrollable
   - Prevents content from being cut off

3. **Core Features** ✅
   - EDF file reading and visualization
   - Multi-channel time series plotting
   - DDA analysis (Single Timeseries, Cross Timeseries, Cross Dynamical, Dynamical Ergodicity)
   - Preprocessing options (highpass, lowpass, notch filters)
   - Channel selection and persistence
   - Analysis history with MinIO storage
   - File manager with directory browsing
   - Embedded Rust API (auto-starts, no Docker required)
   - Settings panel with update checker

### 🚀 Ready for v1.0.0 Release

All essential features are complete and working. The application is stable and ready for initial release.

---

## Architecture Update (October 2025)

**New Backend Strategy:**

- ✅ Embedded Rust API is now the ONLY backend option
- ❌ Removed Docker/FastAPI external server selection
- 🔄 FastAPI will be phased out completely
- 🎯 Institutional broker replaces the need for shared servers (each DDALAB instance has its own API)
- 📱 Embedded API auto-starts when needed
- 🚨 Emergency start/stop controls available in Settings (rarely needed)

## Sync UI Integration Progress

###  Completed

1. **Backend Integration**

   -  Registered sync commands in `main.rs`
   -  Added `AppSyncState` to managed state
   -  Fixed `parking_lot::RwLock` � `tokio::sync::RwLock` for Send compatibility
   -  All 6 sync commands working: connect, disconnect, is_connected, share_result, access_share, revoke_share

2. **TypeScript Integration**

   -  Created `src/types/sync.ts` with AccessPolicy, ShareMetadata, SharedResultInfo interfaces
   -  Created `src/hooks/useSync.ts` hook with full React API
   -  Hook provides: isConnected, isLoading, error, connect, disconnect, shareResult, accessShare, revokeShare

3. **Settings UI**

   -  Added "Institutional Sync" card to SettingsPanel.tsx
   -  Connection status indicator (green dot when connected)
   -  Configuration form with broker URL, user ID, local endpoint inputs
   -  Connect/disconnect functionality with error handling
   -  Connected state showing user ID confirmation

4. **Broker Discovery (mDNS)**
   - Created broker-side discovery announcement system
   - Created client-side discovery scanning
   - SHA256 pre-shared key authentication (password never transmitted)
   - TLS/WSS support flags
   - Discovery UI in SettingsPanel with broker list display
   - Password input for authenticated brokers
   - Security indicators (Lock/Shield icons)
   - Integrated into broker startup
   - Environment config: INSTITUTION_NAME, BROKER_PASSWORD, USE_TLS
   - Added sync commands: sync_discover_brokers, sync_verify_password
   - Updated useSync hook with discoverBrokers and verifyPassword methods

### In Progress / TODO

5. **Peer Download Endpoint** (NOT STARTED)

   - [ ] Add HTTP endpoint in `embedded_api.rs` to serve shared results
   - [ ] Validate share tokens before allowing downloads
   - [ ] Serve result files securely via `/api/share/{token}/download`
   - [ ] Handle CORS for cross-origin requests

6. **Share/Access UI Components** (NOT STARTED)

   - [ ] Create `ShareResultDialog.tsx` component
     - [ ] Share button on analysis results
     - [ ] Access policy selector (public/team/specific users)
     - [ ] Share link display with copy button
     - [ ] Active shares list with revoke option
   - [ ] Create `AccessShareDialog.tsx` component
     - [ ] Paste share link input
     - [ ] Preview shared result metadata
     - [ ] Download button
   - [ ] Integrate dialogs into DDAResults.tsx or main UI

7. **Run DDA on .csv/.ascii files**

   - [ ] Find out what cli arguments to pass to binary to run on .csv/.ascii files

8. **BIDS + OpenNeuro + NEMAR Integration** (NOT STARTED)

   **Goal**: Integrate DDALAB with the BRAIN Initiative ecosystem by supporting BIDS format, enabling OpenNeuro dataset access, and providing NEMAR resource integration for high-performance computing.

   **Current State**: No BIDS support, no OpenNeuro/NEMAR integration, no standardized export format.

   ### Architecture Components

   #### Phase 1: BIDS Format Support

   - [x] Implement BIDS validator (`src/services/bids/validator.ts`)
     - Validate BIDS directory structure
     - Parse `dataset_description.json`
     - Parse `participants.tsv`
     - Validate subject/session folder structure
     - Check EEG/iEEG data file compliance
   - [x] Create BIDS reader service (`src/services/bids/reader.ts`)
     - Read BIDS-formatted EEG/iEEG datasets
     - Parse sidecar JSON metadata
     - Extract channel information from `_channels.tsv`
     - Extract event markers from `_events.tsv`
     - Map BIDS data to DDALAB internal format
   - [x] Create BIDS detection hook (`src/hooks/useBIDSDetection.ts`)
     - Async directory checking for BIDS compliance
     - Parallel detection for multiple directories
     - Metadata enrichment with dataset info
   - [x] Create BIDS types (`src/types/bids.ts`)
     - DirectoryEntry with BIDS metadata
     - BIDSInfo interface for UI display
   - [x] Integrate BIDS detection in FileManager
     - Detect BIDS datasets in directory listings
     - Visual indicators for BIDS directories (purple badge/border)
     - Display dataset name, subject count, modalities
   - [ ] Create BIDS writer/exporter (`src/services/bids/exporter.ts`)
     - Export local analyses to BIDS format
     - Generate `dataset_description.json`
     - Generate `participants.tsv`
     - Create proper folder structure (sub-XX/ses-YY/eeg/)
     - Generate sidecar JSON files with metadata
     - Export DDA results as BIDS derivatives
   - [ ] Add BIDS import UI component (`src/components/BidsImport.tsx`)
     - Browse button to select BIDS root directory
     - Dataset validation with error reporting
     - Subject/session selector
     - Preview available recordings
     - Import button with progress indicator

   #### Phase 2: OpenNeuro Integration

   - [ ] Create OpenNeuro API client (`src/services/openneuro/client.ts`)
     - Implement OpenNeuro GraphQL API calls
     - Dataset search by keywords/tags
     - Dataset metadata retrieval
     - File listing for datasets
     - Download URL generation
   - [ ] Add Rust backend for downloads (`src-tauri/src/openneuro/`)
     - Implement async HTTP downloads
     - Progress tracking per file
     - Resume capability for interrupted downloads
     - Verify file integrity (checksums)
     - Disk space validation before download
   - [ ] Create OpenNeuro browser UI (`src/components/OpenNeuroBrowser.tsx`)
     - Search bar with filters (modality, subjects, keywords)
     - Dataset cards with preview (title, description, stats)
     - Dataset detail view with file tree
     - "Add to Downloads" button for selected files
     - Direct import to DDALAB button
   - [ ] Implement download manager UI (`src/components/DownloadManager.tsx`)
     - Chrome-style downloads panel (collapsible)
     - Download list with progress bars
     - Status indicators (pending, downloading, completed, failed)
     - Individual file progress with speed/ETA
     - Overall progress summary
     - Pause/resume/cancel controls per download
     - Clear completed downloads button
     - "Open in DDALAB" button for completed datasets

   #### Phase 3: NEMAR Resource Integration

   - [ ] Create NEMAR API client (`src/services/nemar/client.ts`)
     - Authentication with NEMAR credentials
     - Dataset submission API
     - Job submission to NSG (Neuroscience Gateway)
     - Job status monitoring
     - Result retrieval from HPC
   - [ ] Implement HPC job submission (`src/services/nemar/hpcSubmission.ts`)
     - Package analysis parameters for NSG
     - Generate batch processing scripts
     - Submit DDA jobs to supercomputer
     - Monitor queue status
     - Retrieve processed results
   - [ ] Add NEMAR upload UI (`src/components/NemarUpload.tsx`)
     - Dataset selection for upload
     - NEMAR authentication form
     - Metadata form (title, description, tags)
     - License selector (Creative Commons, etc.)
     - Privacy options (public/private)
     - Upload progress with validation
   - [ ] Add HPC job manager UI (`src/components/HpcJobManager.tsx`)
     - Submit analysis to NSG/SDSC
     - Job queue visualization
     - Status polling with real-time updates
     - Result download when complete
     - Job history log
     - Cost/resource usage estimates

   #### Phase 4: Background Download System

   - [ ] Implement download queue in Rust (`src-tauri/src/downloads/`)

     ```rust
     pub struct Download {
         id: String,
         url: String,
         destination: PathBuf,
         total_bytes: u64,
         downloaded_bytes: u64,
         status: DownloadStatus, // Pending, Downloading, Paused, Completed, Failed
         speed: f64, // bytes/sec
         error: Option<String>
     }

     pub struct DownloadManager {
         downloads: Arc<RwLock<Vec<Download>>>,
         active_count: usize,
         max_concurrent: usize
     }
     ```

   - [ ] Add Tauri commands for download management

     ```rust
     #[tauri::command]
     async fn add_download(url: String, destination: String) -> Result<String, String>

     #[tauri::command]
     async fn pause_download(id: String) -> Result<(), String>

     #[tauri::command]
     async fn resume_download(id: String) -> Result<(), String>

     #[tauri::command]
     async fn cancel_download(id: String) -> Result<(), String>

     #[tauri::command]
     async fn get_downloads() -> Result<Vec<Download>, String>
     ```

   - [ ] Implement progress events via Tauri events
     - Emit progress updates every 500ms
     - Frontend subscribes to download progress
     - Update UI reactively without polling
   - [ ] Add download persistence
     - Save download queue to disk
     - Resume incomplete downloads on app restart
     - Clean up completed/cancelled downloads

   #### Phase 5: Data Standardization & Export

   - [ ] Create BIDS derivatives for DDA results
     - Define DDA-specific derivatives format
     - Export Q matrices in standardized format
     - Include processing pipeline metadata
     - Generate README describing analysis
   - [ ] Implement sharing workflow
     - Export → BIDS format → Upload to OpenNeuro
     - One-click "Share Analysis" button
     - Pre-filled metadata from session
     - OpenNeuro upload with progress
   - [ ] Add citation generator
     - Generate BibTeX for datasets used
     - Include DDALAB software citation
     - Export citations with analysis results

   #### Phase 6: UI Integration & Polish

   - [ ] Add "Data Sources" menu to main nav
     - OpenNeuro Browser
     - NEMAR Resources
     - Local BIDS Datasets
     - Import from BIDS
   - [ ] Add download indicator to header
     - Badge showing active download count
     - Click to expand download manager
     - System notifications for completed downloads
   - [ ] Add "Export to BIDS" to analysis results
     - One-click export with smart defaults
     - Validation before export
     - Success notification with folder location
   - [ ] Create onboarding tour for new features
     - Highlight OpenNeuro integration
     - Show BIDS import/export workflow
     - Demonstrate NEMAR HPC submission

   ### Technical Requirements

   **Dependencies:**

   - BIDS Validator (JavaScript library or Rust port)
   - OpenNeuro GraphQL client
   - NEMAR API SDK (if available)
   - Async HTTP client (reqwest in Rust)
   - Resume-capable downloader (range requests)

   **APIs to Integrate:**

   - OpenNeuro GraphQL API: `https://openneuro.org/crn/graphql`
   - NEMAR REST API (documentation needed)
   - NSG (Neuroscience Gateway) job submission API
   - SDSC (San Diego Supercomputer Center) APIs

   **Data Format Specifications:**

   - BIDS EEG: https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/03-electroencephalography.html
   - BIDS iEEG: https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/04-intracranial-electroencephalography.html
   - BIDS Derivatives: https://bids-specification.readthedocs.io/en/stable/05-derivatives/01-introduction.html

   ### Files to Create

   - `src/services/bids/validator.ts`
   - `src/services/bids/reader.ts`
   - `src/services/bids/exporter.ts`
   - `src/services/openneuro/client.ts`
   - `src/services/nemar/client.ts`
   - `src/services/nemar/hpcSubmission.ts`
   - `src/components/BidsImport.tsx`
   - `src/components/OpenNeuroBrowser.tsx`
   - `src/components/NemarUpload.tsx`
   - `src/components/DownloadManager.tsx`
   - `src/components/HpcJobManager.tsx`
   - `src-tauri/src/openneuro/mod.rs`
   - `src-tauri/src/downloads/manager.rs`
   - `src-tauri/src/downloads/queue.rs`

   ### Files to Modify

   - `src/components/DashboardLayout.tsx` - Add Data Sources menu
   - `src/components/FileManager.tsx` - Add BIDS dataset detection
   - `src/components/DDAResults.tsx` - Add "Export to BIDS" button
   - `src-tauri/src/main.rs` - Register download management commands
   - `src-tauri/Cargo.toml` - Add reqwest, futures for async downloads

   ### Success Criteria

   - [ ] Can import BIDS-formatted EEG/iEEG datasets
   - [ ] Can validate BIDS structure and show helpful errors
   - [ ] Can export local analyses to valid BIDS format
   - [ ] Can browse and search OpenNeuro datasets
   - [ ] Can download OpenNeuro datasets with progress tracking
   - [ ] Can pause/resume/cancel downloads
   - [ ] Downloads persist across app restarts
   - [ ] Can upload datasets to NEMAR
   - [ ] Can submit HPC jobs to NSG/SDSC
   - [ ] Can monitor HPC job status and retrieve results
   - [ ] Download manager shows all active/completed downloads
   - [ ] System notifications for download completion
   - [ ] One-click workflow: OpenNeuro → Download → Import → Analyze → Export BIDS → Share

   ### Grant Alignment

   This feature directly addresses the NIH grant goals:

   - ✅ "Develop interfaces with recordings stored in OpenNeuro archive"
   - ✅ "Imported directly from OpenNeuro into the NEMAR resource"
   - ✅ "Processed via the Neuroscience Gateway (NSG) at SDSC for HPC"
   - ✅ "Integrate DDALAB into the existing ecosystem supported by the BRAIN Initiative"
   - ✅ "Openly available through GitHub with an Open Source Software license"
   - ✅ "Not depend on proprietary data formats" (BIDS is open standard)

9. **MATLAB-inspired Session Recording** (IN PROGRESS - Backend Complete, Frontend Needed)

   **Goal**: Record user actions in the UI and export to executable .jl (Julia) or .py (Python) scripts that reproduce the analysis and plots.

   **Current State**: ✅ Full Rust backend with DAG-based workflow recording implemented. ❌ No frontend UI integration yet.

   ### Architecture Components

   #### Phase 1: Core Infrastructure (✅ BACKEND COMPLETE)

   - [x] Create Rust action types (`src-tauri/src/recording/actions.rs`)
     - WorkflowAction enum with 7 action types
     - WorkflowNode with timestamps and metadata
     - DependencyType enum (Data, Parameter, Order)
   - [x] Create workflow graph (`src-tauri/src/recording/workflow.rs`)
     - DAG-based using petgraph DiGraph
     - Cycle detection and topological sorting
     - Node and edge management
   - [x] Create code generators (`src-tauri/src/recording/codegen.rs`)
     - Tera template engine integration
     - Python template with numpy, pandas, scipy, matplotlib
     - Julia template with CSV, DataFrames, JSON, MAT, Plots
   - [x] Register 15 Tauri commands (`src-tauri/src/recording/commands.rs`)
     - workflow_new, workflow_clear, workflow_add_node, workflow_remove_node
     - workflow_add_edge, workflow_get_node, workflow_get_all_nodes
     - workflow_get_all_edges, workflow_get_topological_order
     - workflow_validate, workflow_generate_python, workflow_generate_julia
     - workflow_record_action, workflow_export, workflow_import
   - [x] Unit tests (8 tests passing)
   - [ ] **FRONTEND NEEDED**: Create TypeScript types (`src/types/workflow.ts`)
   - [ ] **FRONTEND NEEDED**: Create React hook (`src/hooks/useWorkflow.ts`)
   - [ ] **FRONTEND NEEDED**: Extend appStore with workflow state (`src/store/appStore.ts`)
     - Add `isRecording: boolean`
     - Add `currentWorkflow: WorkflowGraph | null`
     - Add `startRecording()`, `stopRecording()`, `clearRecording()`
     - Add middleware to intercept state changes
   - [ ] **FRONTEND NEEDED**: Create SessionRecorder UI component (`src/components/SessionRecorder.tsx`)
     - Start/Stop recording button
     - Recording indicator (red dot when active)
     - Action counter display
     - Clear recording option

   #### Phase 2: Action Interception (FRONTEND NEEDED)

   - [ ] Hook into file management actions
     - Intercept `setSelectedFile()` → Call `workflow_record_action` with LoadFile
     - Intercept `setSelectedChannels()` → Call `workflow_record_action` with FilterChannels
   - [ ] Hook into visualization actions
     - Intercept `updatePlotState({ preprocessing })` → Call `workflow_record_action` with TransformData
     - Intercept plot generation → Call `workflow_record_action` with GeneratePlot
   - [ ] Hook into DDA actions
     - Intercept `updateAnalysisParameters()` → Call `workflow_record_action` with SetDDAParameters
     - Intercept analysis submission → Call `workflow_record_action` with RunDDAAnalysis
   - [ ] Capture action metadata
     - Timestamps automatically added by backend
     - Track dependencies between actions
     - Store relevant state snapshots

   #### Phase 3-4: Code Generation (✅ BACKEND COMPLETE)

   - [x] Python code generator with Tera templates
     - Imports: numpy, pandas, scipy, matplotlib
     - Helper functions for DDA, plotting, filtering
     - Action-to-code mapping implemented
   - [x] Julia code generator with Tera templates
     - Imports: CSV, DataFrames, JSON, MAT, Plots
     - Helper functions for DDA, plotting, filtering
     - Action-to-code mapping implemented

   #### Phase 5: Export Functionality (PARTIALLY COMPLETE)

   - [x] Backend export commands exist (`workflow_generate_python`, `workflow_generate_julia`)
   - [ ] **FRONTEND NEEDED**: Implement export dialog component (`src/components/dialogs/ExportSessionDialog.tsx`)
     - Format selection (Julia/Python radio buttons)
     - File name input (auto-generated: `ddalab_session_YYYYMMDD_HHMMSS.{jl|py}`)
     - Preview pane showing generated code
     - Save location picker (Tauri file dialog)
     - Call `workflow_generate_python` or `workflow_generate_julia`
     - Write file to disk using Tauri fs API
   - [ ] **FRONTEND NEEDED**: Add "Export Session" button to DashboardLayout header
   - [ ] **FRONTEND NEEDED**: Implement file write with error handling

   #### Phase 6: Testing & Polish

   - [ ] Test Python scripts execute correctly
     - Verify imports resolve
     - Verify data loads correctly
     - Verify preprocessing runs
     - Verify plots render
   - [ ] Test Julia scripts execute correctly
     - Verify packages available
     - Verify data loads correctly
     - Verify DSP operations work
     - Verify plots render
   - [ ] Add session preview/edit functionality
     - Show list of recorded actions
     - Allow removing individual actions
     - Allow reordering actions
   - [ ] Add action filtering options
     - Toggle recording for specific action types
     - Option to exclude file paths (use placeholders)
   - [ ] Documentation
     - User guide for session recording
     - Example recorded sessions
     - Dependency installation instructions (pip/julia packages)

   ### Action Mapping Reference

   **File Operations:**

   ```python
   # Python
   file_path = "/Users/data/recording.edf"

   # Julia
   file_path = "/Users/data/recording.edf"
   ```

   **Channel Selection:**

   ```python
   # Python
   channels = ["LAT1", "LAT2", "LAT3", "LAT4"]

   # Julia
   channels = ["LAT1", "LAT2", "LAT3", "LAT4"]
   ```

   **Preprocessing:**

   ```python
   # Python
   highpass_cutoff = 0.5  # Hz
   lowpass_cutoff = 70    # Hz
   notch_frequencies = [50]  # Hz

   # Julia
   highpass_cutoff = 0.5  # Hz
   lowpass_cutoff = 70    # Hz
   notch_frequencies = [50]  # Hz
   ```

   **DDA Analysis:**

   ```python
   # Python
   variants = ["single_timeseries", "cross_timeseries"]
   window_length = 1000
   window_step = 100
   scale_min = 4
   scale_max = 100
   scale_num = 20

   # Julia
   variants = ["single_timeseries", "cross_timeseries"]
   window_length = 1000
   window_step = 100
   scale_min = 4
   scale_max = 100
   scale_num = 20
   ```

   **Visualization:**

   ```python
   # Python
   time_window = (0, 30)  # seconds
   amplitude_scale = 100
   plt.figure(figsize=(12, 8))
   # ... plotting code

   # Julia
   time_window = (0, 30)  # seconds
   amplitude_scale = 100
   plot(...)
   ```

   ### Files Already Created (✅ Backend Complete)

   - [x] `src-tauri/src/recording/actions.rs` - WorkflowAction types
   - [x] `src-tauri/src/recording/workflow.rs` - DAG graph implementation
   - [x] `src-tauri/src/recording/codegen.rs` - Python/Julia code generators
   - [x] `src-tauri/src/recording/commands.rs` - 15 Tauri commands
   - [x] `src-tauri/src/recording/mod.rs` - Module exports

   ### Files to Create (❌ Frontend Needed)

   - [ ] `src/types/workflow.ts` - TypeScript type definitions
   - [ ] `src/hooks/useWorkflow.ts` - React hook for workflow management
   - [ ] `src/components/SessionRecorder.tsx` - Recording UI controls
   - [ ] `src/components/dialogs/ExportSessionDialog.tsx` - Export dialog

   ### Files to Modify (❌ Frontend Needed)

   - [ ] `src/store/appStore.ts` - Add recording state and middleware
   - [ ] `src/components/DashboardLayout.tsx` - Integrate SessionRecorder component
   - [ ] `src/components/DDAAnalysis.tsx` - Add action recording hooks
   - [ ] `src/components/TimeSeriesPlot.tsx` - Add action recording hooks
   - [ ] `src/components/FileManager.tsx` - Add action recording hooks

   ### Success Criteria

   - [x] Backend can manage workflow graph (DAG)
   - [x] Backend can generate Python scripts
   - [x] Backend can generate Julia scripts
   - [x] Backend has cycle detection and topological sorting
   - [x] Backend commands are registered and tested
   - [ ] Can start/stop recording from UI with visual feedback
   - [ ] All major actions captured (file, channels, preprocessing, DDA, viz)
   - [ ] Can export to .jl file that executes successfully
   - [ ] Can export to .py file that executes successfully
   - [ ] Generated code is readable and well-commented
   - [ ] Generated code includes necessary imports
   - [ ] Can preview recorded actions before export
   - [ ] Can clear/reset recording
   - [ ] Session metadata included in exported files (version, date, platform)

### <� Mobile Compatibility Considerations

**Current Architecture:** P2P direct downloads between peers

-  Works on Desktop (macOS/Windows/Linux)
- L Won't work on iOS/Android (devices behind NAT, cannot accept incoming HTTP)

**Mobile Solutions:**

1. **Broker-Proxied Mode** (Recommended)

   - Broker temporarily stores small result files
   - Mobile devices download from broker instead of peer
   - Add platform detection: `cfg!(target_os = "ios") || cfg!(target_os = "android")`

2. **WebRTC Data Channels**

   - NAT traversal works on mobile
   - More complex implementation

3. **Hybrid Approach**
   - Desktop: Direct P2P (current design)
   - Mobile: Broker-proxied downloads

### =� Key Files Modified

- `src-tauri/src/main.rs` - Registered sync commands
- `src-tauri/src/sync/commands.rs` - Fixed tokio::RwLock compatibility
- `src/types/sync.ts` - Type definitions
- `src/hooks/useSync.ts` - React hook
- `src/components/SettingsPanel.tsx` - Sync configuration UI

### = Related Packages

- `packages/ddalab-broker/` - Institutional sync broker (Rust WebSocket server)
- `packages/ddalab-tauri/src-tauri/src/sync/` - SyncClient implementation

### =� Notes

- Sync is completely optional - app fully functional offline
- Local-first architecture - all data stays on device unless explicitly shared
- Broker only coordinates - actual data transfers are peer-to-peer (on desktop)
- No authentication on broker yet - user ID is self-declared
