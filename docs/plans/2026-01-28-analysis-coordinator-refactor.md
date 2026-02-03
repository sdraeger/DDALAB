# Analysis Coordinator Refactor

## Problem Statement

The DDA analysis workflow has race conditions caused by:
1. Four independent listeners for the same "dda-progress" event
2. Three state sources (local state, Zustand store, TanStack Query cache) that can desync
3. Results not logically tied to the file they were computed for
4. File switching during analysis causes parameter/result mismatches

## Design Goals

1. **Single source of truth** - One place owns analysis state
2. **File-scoped analyses** - Results tied to specific file paths, not "current selection"
3. **Multi-file support** - User can switch files while analysis runs; results appear when ready
4. **Event coordination** - One listener, one dispatcher
5. **Graceful degradation** - Silent failures become visible errors

---

## Architecture

### New: `useAnalysisCoordinator` Hook

Central coordinator that manages all analysis state.

```typescript
// Location: /packages/ddalab-tauri/src/hooks/useAnalysisCoordinator.ts

interface AnalysisJob {
  id: string;
  filePath: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  currentStep: string;
  startedAt: number;
  result?: DDAResult;
  error?: string;
}

interface AnalysisCoordinatorState {
  // Active jobs keyed by analysisId
  jobs: Map<string, AnalysisJob>;

  // Quick lookup: which job is running for a file?
  fileToJob: Map<string, string>; // filePath → analysisId

  // Actions
  startAnalysis: (filePath: string, request: DDARequest) => Promise<string>;
  cancelAnalysis: (analysisId: string) => Promise<void>;
  getJobForFile: (filePath: string) => AnalysisJob | undefined;
  getJobById: (analysisId: string) => AnalysisJob | undefined;
}
```

### State Flow

```
User clicks "Run Analysis"
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  useAnalysisCoordinator.startAnalysis(filePath, req)   │
│                                                         │
│  1. Create job entry: { id, filePath, status: pending } │
│  2. Store in jobs Map                                   │
│  3. Update fileToJob Map                                │
│  4. Call backend submitDDAAnalysis()                    │
│  5. Update status: 'running'                            │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Single Event Listener (in coordinator)                 │
│                                                         │
│  listen("dda-progress", (event) => {                   │
│    const job = jobs.get(event.analysis_id);            │
│    if (!job) return; // Unknown job, ignore            │
│                                                         │
│    updateJob(event.analysis_id, {                      │
│      progress: event.progress_percent,                 │
│      currentStep: event.current_step,                  │
│      status: event.phase === 'completed' ? 'completed' │
│             : event.phase === 'error' ? 'error'        │
│             : 'running',                               │
│      result: event.result,                             │
│      error: event.error_message,                       │
│    });                                                  │
│  });                                                    │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Components Subscribe to Specific Jobs                  │
│                                                         │
│  // In DDAAnalysis.tsx                                  │
│  const job = useAnalysisJob(currentFilePath);          │
│                                                         │
│  // Shows progress for THIS file only                   │
│  // Even if user switches to different file             │
└─────────────────────────────────────────────────────────┘
```

### Component Changes

#### DDAAnalysis.tsx

**Before (problematic):**
```typescript
// Multiple state sources
const [results, setResults] = useState<DDAResult | null>(null);
const [localIsRunning, setLocalIsRunning] = useState(false);
const progressEvent = useDDAProgress(submissionId, isPending);
const currentAnalysis = useAppStore(state => state.dda.currentAnalysis);
```

**After (coordinated):**
```typescript
// Single source via coordinator
const {
  job,           // Current job for this file (if any)
  startAnalysis, // Starts new analysis
  isRunning,     // Derived: job?.status === 'running'
  progress,      // Derived: job?.progress ?? 0
  result,        // Derived: job?.result
} = useAnalysisForFile(selectedFile?.file_path);

// No local state for results - comes from coordinator
// No separate progress hook - comes from coordinator
// No store subscription - comes from coordinator
```

#### DashboardLayout.tsx

**Remove:**
- The `listen<DDAProgressEvent>` effect (lines 156-170)
- The `setDDARunning(false)` calls

**Keep:**
- Auto-load from history (but use coordinator to check if job exists first)

#### PopoutDashboard.tsx

**Remove:**
- The duplicate `listen<DDAProgressEvent>` effect (lines 513-525)

---

## Implementation Plan

### Phase 1: Create Analysis Coordinator (Foundation)

**Files to create:**
- `src/hooks/useAnalysisCoordinator.ts` - Core coordinator hook
- `src/store/slices/analysisSlice.ts` - Zustand slice for analysis jobs

**Tasks:**
1. Define `AnalysisJob` interface
2. Create Zustand slice with jobs Map
3. Implement single event listener in coordinator
4. Create `useAnalysisForFile(filePath)` selector hook
5. Add unit tests for state transitions

### Phase 2: Migrate DDAAnalysis Component

**Files to modify:**
- `src/components/DDAAnalysis.tsx`

**Tasks:**
1. Replace `useDDAProgress` with coordinator
2. Replace local `results` state with coordinator
3. Replace `submitAnalysisMutation` with coordinator's `startAnalysis`
4. Update progress bar to use coordinator's progress
5. Keep parameters local (they're UI state, not analysis state)

### Phase 3: Remove Duplicate Listeners

**Files to modify:**
- `src/components/DashboardLayout.tsx`
- `src/components/popout/PopoutDashboard.tsx`
- `src/hooks/useDDAAnalysis.ts` (deprecate `useDDAProgress`)

**Tasks:**
1. Remove `listen<DDAProgressEvent>` from DashboardLayout
2. Remove `listen<DDAProgressEvent>` from PopoutDashboard
3. Update `setDDARunning` calls to derive from coordinator
4. Deprecate `useDDAProgress` hook (keep for backwards compat, delegate to coordinator)

### Phase 4: History Integration

**Files to modify:**
- `src/components/dda/DDAWithHistory.tsx`
- `src/hooks/useDDAAnalysis.ts`

**Tasks:**
1. When job completes, auto-save to history
2. History queries remain via TanStack Query (read-only cache)
3. Coordinator is source of truth for "live" analyses
4. History is source of truth for "past" analyses

### Phase 5: Multi-Window Support

**Files to modify:**
- `src/components/popout/PopoutDashboard.tsx`

**Tasks:**
1. Popout windows subscribe to same coordinator (Zustand is shared)
2. Progress shows correctly in any window viewing that file
3. Results appear in correct window based on file path

---

## API Design

### useAnalysisCoordinator()

```typescript
function useAnalysisCoordinator() {
  return {
    // All active jobs
    jobs: Map<string, AnalysisJob>,

    // Start new analysis (returns job ID)
    startAnalysis: (filePath: string, request: DDARequest) => Promise<string>,

    // Cancel running analysis
    cancelAnalysis: (analysisId: string) => Promise<void>,

    // Check if any analysis is running (for global UI indicators)
    hasRunningJobs: boolean,
  };
}
```

### useAnalysisForFile(filePath)

```typescript
function useAnalysisForFile(filePath: string | undefined) {
  return {
    // Current job for this file (undefined if none)
    job: AnalysisJob | undefined,

    // Convenience accessors
    isRunning: boolean,
    isCompleted: boolean,
    hasError: boolean,
    progress: number,        // 0-100
    currentStep: string,     // "Loading data...", etc.
    result: DDAResult | undefined,
    error: string | undefined,

    // Actions scoped to this file
    startAnalysis: (request: DDARequest) => Promise<string>,
    cancel: () => Promise<void>,
  };
}
```

---

## Migration Strategy

1. **Additive first** - Create coordinator alongside existing code
2. **Gradual adoption** - Components opt-in one at a time
3. **Feature flag** - `USE_ANALYSIS_COORDINATOR` env var for rollback
4. **Deprecation warnings** - Old hooks log warnings, delegate to coordinator
5. **Remove old code** - After all components migrated

---

## Success Criteria

- [ ] Single event listener for "dda-progress"
- [ ] Results always associated with correct file
- [ ] File switching doesn't break running analysis
- [ ] Progress shows correctly in multi-window setup
- [ ] No race conditions in state updates
- [ ] Errors surfaced to user (not silent)
- [ ] History saves reliably with retry

---

## User Experience Decisions

### 1. App Restart Behavior
- Running analyses are **NOT persisted** across app restart
- On restart, previously running analyses appear as "interrupted" in a status bar popover
- User can re-launch interrupted analyses with one click

### 2. Parallel vs Sequential Analyses
When user starts analysis on File B while File A is still running:
- **Show choice dialog:**
  - "Run in parallel" - Both analyses run simultaneously
  - "Wait for current" - Queue File B's analysis after File A completes
  - "Cancel current" - Stop File A, start File B immediately
- Remember user's preference (store in app preferences)

### 3. Tab Bar Indicators
- Tabs with running analyses show a **spinner/pulse indicator**
- Tabs with completed (unseen) results show a **dot badge**
- Clicking indicator opens **popover** with:
  - Progress percentage
  - Current step (e.g., "Computing eigenvalues...")
  - Cancel button
  - "View" button (switches to that file's Analyze tab)

---

## Additional Components

### AnalysisStatusPopover (Status Bar)
```
┌─────────────────────────────────────────────┐
│ Running Analyses                            │
├─────────────────────────────────────────────┤
│ 📊 subject01.edf          45%  [Cancel]    │
│    Computing DDA matrices...                │
├─────────────────────────────────────────────┤
│ Interrupted (restart to continue)           │
├─────────────────────────────────────────────┤
│ ⚠️ subject02.edf          [Re-launch]      │
│    Was at 72% when app closed               │
└─────────────────────────────────────────────┘
```

### FileTab Analysis Indicator
```
┌──────────────────────────────┐
│ 📄 subject01.edf  ◉ ←────── Pulsing indicator (running)
└──────────────────────────────┘

┌──────────────────────────────┐
│ 📄 subject02.edf  • ←────── Dot badge (results ready)
└──────────────────────────────┘
```

### Analysis Queue Dialog
```
┌─────────────────────────────────────────────┐
│ Analysis Already Running                    │
├─────────────────────────────────────────────┤
│ "subject01.edf" has an analysis in progress │
│ (45% complete)                              │
│                                             │
│ What would you like to do?                  │
│                                             │
│ ○ Run in parallel (both analyses run)       │
│ ○ Wait (queue after current completes)      │
│ ○ Cancel current and start new              │
│                                             │
│ ☐ Remember my choice                        │
│                                             │
│            [Cancel]  [Continue]             │
└─────────────────────────────────────────────┘
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing workflows | Feature flag for rollback |
| State migration complexity | Coordinator reads from old store initially |
| Multi-window sync issues | Zustand is already shared; test thoroughly |
| Performance regression | Use selectors to minimize re-renders |

---

## Updated Implementation Phases

### Phase 1: Core Coordinator (Foundation)
- Create `useAnalysisCoordinator` hook
- Create Zustand `analysisSlice`
- Single event listener
- Basic job lifecycle (start → running → completed/error)

### Phase 2: Migrate DDAAnalysis Component
- Replace old state with coordinator
- Remove duplicate progress tracking
- Verify results tied to correct file

### Phase 3: Remove Duplicate Listeners
- Clean up DashboardLayout
- Clean up PopoutDashboard
- Deprecate old hooks

### Phase 4: Tab Bar Indicators
- Add running/completed indicators to FileTab
- Add analysis popover on click
- Style consistent with DDALAB design

### Phase 5: Status Bar Integration
- Add AnalysisStatusPopover to HealthStatusBar
- Show running analyses count
- Show interrupted analyses (for re-launch)

### Phase 6: Parallel/Sequential Choice
- Create queue dialog component
- Add preference storage
- Implement analysis queue logic

---

## Timeline Estimate

- Phase 1: Foundation - 1 session
- Phase 2: DDAAnalysis migration - 1 session
- Phase 3: Remove duplicates - 0.5 session
- Phase 4: Tab indicators - 1 session
- Phase 5: Status bar - 0.5 session
- Phase 6: Queue dialog - 0.5 session
- Testing & polish - 1 session

**Total: ~6 focused sessions**
