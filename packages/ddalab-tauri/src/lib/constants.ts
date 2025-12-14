/**
 * Application constants for query keys, API endpoints, and configuration
 * Centralizes all constant values to prevent magic strings and ensure consistency
 */

// ============================================================================
// Query Key Factories
// ============================================================================

/**
 * Query key factories for TanStack Query
 * Use these instead of inline key arrays for type safety and consistency
 */
export const queryKeys = {
  // File Management
  fileManagement: {
    all: ["fileManagement"] as const,
    files: () => [...queryKeys.fileManagement.all, "files"] as const,
    fileInfo: (filePath: string) =>
      [...queryKeys.fileManagement.all, "fileInfo", filePath] as const,
    directory: (path: string) =>
      [...queryKeys.fileManagement.all, "directory", path] as const,
    availableFiles: () =>
      [...queryKeys.fileManagement.all, "availableFiles"] as const,
  },

  // Time Series Data
  timeSeries: {
    all: ["timeSeries"] as const,
    data: (filePath: string, channels: string[], start: number, size: number) =>
      [
        ...queryKeys.timeSeries.all,
        "data",
        filePath,
        channels.join(","),
        start,
        size,
      ] as const,
    chunk: (filePath: string, chunkStart: number, chunkSize: number) =>
      [
        ...queryKeys.timeSeries.all,
        "chunk",
        filePath,
        chunkStart,
        chunkSize,
      ] as const,
  },

  // DDA Analysis
  dda: {
    all: ["dda"] as const,
    analysis: (id: string) => [...queryKeys.dda.all, "analysis", id] as const,
    results: () => [...queryKeys.dda.all, "results"] as const,
    history: () => [...queryKeys.dda.all, "history"] as const,
  },

  // ICA Analysis
  ica: {
    all: ["ica"] as const,
    results: () => [...queryKeys.ica.all, "results"] as const,
    result: (id: string) => [...queryKeys.ica.all, "result", id] as const,
  },

  // NSG Jobs
  nsg: {
    all: ["nsg"] as const,
    credentials: () => [...queryKeys.nsg.all, "credentials"] as const,
    jobs: () => [...queryKeys.nsg.all, "jobs"] as const,
    job: (jobId: string) => [...queryKeys.nsg.all, "job", jobId] as const,
    jobStatus: (jobId: string) =>
      [...queryKeys.nsg.all, "jobStatus", jobId] as const,
  },

  // API Status
  apiStatus: {
    all: ["apiStatus"] as const,
    status: () => [...queryKeys.apiStatus.all, "status"] as const,
    health: (url: string) =>
      [...queryKeys.apiStatus.all, "health", url] as const,
    config: () => [...queryKeys.apiStatus.all, "config"] as const,
  },

  // Health Checks
  health: {
    all: ["health"] as const,
    status: (url: string) => [...queryKeys.health.all, "status", url] as const,
  },

  // BIDS
  bids: {
    all: ["bids"] as const,
    detection: (path: string) =>
      [...queryKeys.bids.all, "detection", path] as const,
    description: (path: string) =>
      [...queryKeys.bids.all, "description", path] as const,
    summary: (path: string) =>
      [...queryKeys.bids.all, "summary", path] as const,
    batchDetection: (paths: string[]) =>
      [...queryKeys.bids.all, "batch", paths.join(",")] as const,
  },

  // Updates
  updates: {
    all: ["updates"] as const,
    status: () => [...queryKeys.updates.all, "status"] as const,
  },

  // App Info
  appInfo: {
    all: ["appInfo"] as const,
    version: () => [...queryKeys.appInfo.all, "version"] as const,
    logsPath: () => [...queryKeys.appInfo.all, "logsPath"] as const,
    preferences: () => [...queryKeys.appInfo.all, "preferences"] as const,
    dataDirectory: () => [...queryKeys.appInfo.all, "dataDirectory"] as const,
  },

  // OpenNeuro
  openNeuro: {
    all: ["openNeuro"] as const,
    datasets: () => [...queryKeys.openNeuro.all, "datasets"] as const,
    datasetsBatch: (after?: string) =>
      [...queryKeys.openNeuro.all, "datasetsBatch", after ?? "start"] as const,
    dataset: (id: string) =>
      [...queryKeys.openNeuro.all, "dataset", id] as const,
    datasetFiles: (id: string, snapshot?: string) =>
      [...queryKeys.openNeuro.all, "files", id, snapshot ?? "latest"] as const,
    datasetSize: (id: string, snapshot?: string) =>
      [...queryKeys.openNeuro.all, "size", id, snapshot ?? "latest"] as const,
    apiKey: () => [...queryKeys.openNeuro.all, "apiKey"] as const,
  },

  // Notifications
  notifications: {
    all: ["notifications"] as const,
    list: (limit?: number) =>
      [...queryKeys.notifications.all, "list", limit ?? "all"] as const,
    unreadCount: () => [...queryKeys.notifications.all, "unreadCount"] as const,
  },

  // Annotations
  annotations: {
    all: ["annotations"] as const,
    forFile: (filePath: string) =>
      [...queryKeys.annotations.all, "file", filePath] as const,
  },
} as const;

// ============================================================================
// API Endpoints
// ============================================================================

/**
 * API endpoint constants
 * Use these instead of inline strings to ensure consistency
 */
export const API_ENDPOINTS = {
  // Health
  HEALTH: "/health",

  // Files
  FILES: "/files",
  FILE_INFO: "/files/info",
  FILE_DATA: "/files/data",
  FILE_CHUNK: "/files/chunk",

  // DDA Analysis
  DDA_ANALYZE: "/dda/analyze",
  DDA_RESULTS: "/dda/results",
  DDA_PROGRESS: "/dda/progress",

  // ICA Analysis
  ICA_RUN: "/ica/run",
  ICA_RESULTS: "/ica/results",
  ICA_RECONSTRUCT: "/ica/reconstruct",

  // Annotations
  ANNOTATIONS: "/annotations",
  ANNOTATIONS_EXPORT: "/annotations/export",
  ANNOTATIONS_IMPORT: "/annotations/import",

  // Directory
  DIRECTORY: "/directory",
  DIRECTORY_LIST: "/directory/list",

  // BIDS
  BIDS_DETECT: "/bids/detect",
  BIDS_DESCRIPTION: "/bids/description",
} as const;

// ============================================================================
// Timing Constants
// ============================================================================

/**
 * Stale time configurations for different query types (in milliseconds)
 */
export const STALE_TIMES = {
  /** File metadata rarely changes - 10 minutes */
  FILE_INFO: 10 * 60 * 1000,
  /** File list can change more frequently - 5 minutes */
  FILE_LIST: 5 * 60 * 1000,
  /** Analysis results are immutable - 1 hour */
  ANALYSIS_RESULTS: 60 * 60 * 1000,
  /** API status should be checked frequently - 30 seconds */
  API_STATUS: 30 * 1000,
  /** Health checks - 1 minute */
  HEALTH: 60 * 1000,
  /** App preferences rarely change - 5 minutes */
  PREFERENCES: 5 * 60 * 1000,
  /** Updates check - 1 hour */
  UPDATES: 60 * 60 * 1000,
  /** NSG job status during active polling - 5 seconds */
  NSG_JOB_POLLING: 5 * 1000,
  /** BIDS detection - 10 minutes */
  BIDS: 10 * 60 * 1000,
} as const;

/**
 * Garbage collection time configurations (in milliseconds)
 */
export const GC_TIMES = {
  /** Default GC time - 10 minutes */
  DEFAULT: 10 * 60 * 1000,
  /** Long-lived data - 30 minutes */
  LONG: 30 * 60 * 1000,
  /** Short-lived data - 5 minutes */
  SHORT: 5 * 60 * 1000,
  /** Analysis results - 1 hour */
  ANALYSIS: 60 * 60 * 1000,
} as const;

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
  /** Maximum number of retries for failed requests */
  MAX_RETRIES: 3,
  /** Base delay between retries in milliseconds */
  BASE_DELAY: 1000,
  /** Maximum delay between retries in milliseconds */
  MAX_DELAY: 10000,
} as const;

// ============================================================================
// UI Constants
// ============================================================================

/**
 * Animation durations (in milliseconds)
 */
export const ANIMATION_DURATIONS = {
  FAST: 150,
  NORMAL: 200,
  SLOW: 300,
  VERY_SLOW: 500,
} as const;

/**
 * Debounce/throttle delays (in milliseconds)
 */
export const DEBOUNCE_DELAYS = {
  /** Search input debounce */
  SEARCH: 300,
  /** Window resize debounce */
  RESIZE: 100,
  /** State persistence debounce */
  PERSIST: 500,
  /** Scroll event throttle */
  SCROLL: 16,
} as const;

/**
 * Default chunk sizes for data loading
 */
export const CHUNK_SIZES = {
  /** Default time series chunk size in samples */
  TIME_SERIES: 10000,
  /** Maximum chunk size */
  MAX: 100000,
  /** Minimum chunk size */
  MIN: 1000,
} as const;

// ============================================================================
// DDA Constants
// ============================================================================

/**
 * DDA variant identifiers
 */
export const DDA_VARIANTS = {
  SINGLE_TIMESERIES: "single_timeseries",
  DUAL_ENTROPY: "dual_entropy",
  SYNCHRONY: "synchrony",
  CROSS_TIMESERIES: "cross_timeseries",
  CAUSAL_DIRECTED: "causal_directed",
} as const;

/**
 * Default DDA analysis parameters
 */
export const DDA_DEFAULTS = {
  WINDOW_LENGTH: 1000,
  WINDOW_STEP: 500,
  MODEL_DIMENSION: 4,
  POLYNOMIAL_ORDER: 4,
  NR_TAU: 2,
  DELAYS: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
} as const;

// ============================================================================
// UI Timing Constants
// ============================================================================

/**
 * Toast/notification display durations (in milliseconds)
 */
export const TOAST_DURATIONS = {
  /** Short notifications - 3 seconds */
  SHORT: 3000,
  /** Medium notifications - 5 seconds */
  MEDIUM: 5000,
  /** Long notifications - 8 seconds */
  LONG: 8000,
} as const;

/**
 * Polling intervals (in milliseconds)
 */
export const POLLING_INTERVALS = {
  /** Window state polling - 1 second */
  WINDOW_STATE: 1000,
  /** Progress updates - 500ms */
  PROGRESS: 500,
  /** Health check - 30 seconds */
  HEALTH: 30000,
} as const;

// ============================================================================
// List Virtualization
// ============================================================================

/**
 * Virtualization configuration for react-window lists
 * Lists with fewer items than the threshold render normally
 * Lists with more items use virtualized rendering for performance
 */
export const VIRTUALIZATION = {
  /** Item count threshold to enable virtualization */
  THRESHOLD: 50,
  /** Default row height for fixed-size lists */
  DEFAULT_ROW_HEIGHT: 36,
  /** Default overscan count (items rendered outside viewport) */
  OVERSCAN_COUNT: 5,
} as const;

// ============================================================================
// DDA Analysis Configuration
// ============================================================================

/**
 * Configuration constants for Delay Differential Analysis
 */
export const DDA_ANALYSIS = {
  /** Minimum display time for progress bar (ms) - prevents flickering on fast operations */
  MIN_PROGRESS_DISPLAY_TIME: 500,
  /** Default delay values for DDA analysis */
  DEFAULT_DELAYS: [7, 10] as const,
  /** Minimum time range (seconds) for analysis */
  MIN_TIME_RANGE: 0.1,
  /** Default time range end (seconds) when no file is loaded */
  DEFAULT_TIME_END: 30,
  /** Default window step value */
  DEFAULT_WINDOW_STEP: 10,
  /** Default preprocessing highpass filter (Hz) */
  DEFAULT_HIGHPASS: 0.5,
  /** Maximum channels to auto-select on file load */
  DEFAULT_CHANNEL_LIMIT: 8,
} as const;
