# DDALAB Comprehensive Fixes Plan

> **Status**: In Progress
> **Created**: 2025-01-04
> **Priority**: Critical issues first, then high, medium, low

---

## 1. Frontend Code Quality Fixes

### 1.1 Async Listener Race Conditions
- [x] Fix `useDDAAnalysis.ts` - async listener setup race condition
- [x] Fix `useSync.ts` - async listener setup race condition
- [x] Fix `usePopoutWindows.ts` - multiple async setup functions race condition

### 1.2 Error Handling
- [x] Add root-level ErrorBoundary in `layout.tsx`
- [x] Fix silent persistence failures - add user feedback (added notifyPersistenceError to all error handlers in statePersistenceService.ts)
- [x] Clean up requestAnimationFrame in `popout/minimal/page.tsx` (added RAF ID tracking and cleanup)

### 1.3 Timer Cleanup
- [x] Audit and fix setTimeout in `useFileNavigation.ts` (added cleanup on unmount)
- [x] Create utility for safe timer management (created utils/safeTimers.ts with TimerManager class and useSafeTimers, useSafeTimeout, useSafeInterval, useSafeRAF, useDebouncedCallback hooks)

---

## 2. Rust Backend Robustness Fixes

### 2.1 Concurrency Issues
- [x] Fix global `SEGMENT_CANCELLED` flag race condition in `file_commands.rs`
- [x] Implement bounded set for cancelled analyses to prevent memory leak in `api/state.rs`

### 2.2 Resource Management
- [x] Fix double-wrapped Mutex in `openneuro_commands.rs` (changed to RwLock + inner Mutex)
- [x] Pre-allocate HashMap capacity in `sync/client.rs` (reviewed - small maps don't need pre-allocation)

### 2.3 Streaming Buffer
- [x] Fix unnecessary cloning in `streaming/buffer.rs` (removed .clone() in DropNewest/Block strategies)
- [x] Clean up ring buffer write_pos logic in `streaming/processor.rs` (fixed double-increment bug)

---

## 3. UX & Input Validation Fixes

### 3.1 Numeric Input Validation
- [x] Add min < max validation in `ColorRangeControl.tsx`
- [x] Add time range validation in `FileSegmentationDialog.tsx`
- [x] Add port validation (1-65535) in `StreamConfigDialog.tsx`
- [x] Add window size validation in `WindowSizeSelector.tsx`

### 3.2 Error Recovery
- [x] Add retry mechanism in `BIDSUploadDialog.tsx`
- [x] Fix error message disappearing too quickly in `FileDropZone.tsx`
- [x] Add retry mechanism in `OpenNeuroDownloadDialog.tsx`

### 3.3 Loading States
- [x] Add skeleton loaders for OpenNeuro dataset loading (added SkeletonDatasetCard and SkeletonDatasetList to skeleton-variants.tsx, used in OpenNeuroBrowser.tsx)

---

## 4. Security Fixes

### 4.1 API Security
- [x] Add security headers (X-Content-Type-Options, X-Frame-Options, CSP, XSS-Protection, Referrer-Policy, Permissions-Policy)
- [x] Request body size limits already exist (100 MB limit in router.rs)
- [x] CSRF mitigated: Session token required for all API calls + localhost-only CORS

### 4.2 Session Management
- [x] Implemented bounded set for cancelled analyses (prevents memory leak)

---

## 5. Performance Fixes

### 5.1 Query Optimization
- [x] Stabilize query cache keys for channel arrays (sorted before joining)
- [ ] Add request deduplication

### 5.2 Large File Handling
- [ ] Document streaming decimation approach (complex - future work)

---

## Progress Summary

| Category | Total | Done | Remaining |
|----------|-------|------|-----------|
| Frontend Quality | 8 | 8 | 0 |
| Backend Robustness | 6 | 6 | 0 |
| UX/Validation | 10 | 10 | 0 |
| Security | 4 | 4 | 0 |
| Performance | 3 | 1 | 2 |
| **Total** | **31** | **29** | **2** |

---

## Implementation Notes

### Principles
- **DRY**: Extract common patterns into utilities
- **KISS**: Simple, focused fixes
- **SOLID**: Single responsibility per fix

### Testing
- Run `bun run typecheck` after each frontend change
- Run `cargo check` after each Rust change
