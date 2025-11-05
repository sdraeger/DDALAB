import { useState, useCallback, useMemo, useEffect, memo } from "react";
import {
  Search,
  Download,
  ExternalLink,
  Database,
  Calendar,
  Eye,
  TrendingDown,
  Key,
  Upload,
  AlertTriangle,
} from "lucide-react";
import {
  openNeuroService,
  type OpenNeuroDataset,
} from "../services/openNeuroService";
import { open } from "@tauri-apps/plugin-shell";
import { OpenNeuroDownloadDialog } from "./OpenNeuroDownloadDialog";
import {
  useOpenNeuroDatasetsBatch,
  useOpenNeuroApiKey,
} from "../hooks/useOpenNeuro";
import { Badge } from "./ui/badge";

// Memoized dataset card component to prevent unnecessary re-renders
const DatasetCard = memo(
  ({
    dataset,
    isSelected,
    onSelect,
    onOpenInBrowser,
  }: {
    dataset: OpenNeuroDataset;
    isSelected: boolean;
    onSelect: (dataset: OpenNeuroDataset) => void;
    onOpenInBrowser: (id: string) => void;
  }) => {
    return (
      <div
        onClick={() => onSelect(dataset)}
        className={`p-4 border rounded-lg cursor-pointer transition-all ${
          isSelected
            ? "bg-primary/10 border-primary shadow-sm ring-2 ring-primary/20"
            : "hover:bg-accent hover:shadow-sm"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-lg">{dataset.id}</div>
            {dataset.name && dataset.name !== dataset.id && (
              <div className="text-sm font-medium text-muted-foreground mt-1">
                {dataset.name}
              </div>
            )}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {dataset.summary?.modalities &&
                dataset.summary.modalities.length > 0 && (
                  <>
                    {/* NEMAR Badge */}
                    {dataset.summary.modalities.some((m) =>
                      ["eeg", "meg", "ieeg"].includes(m.toLowerCase()),
                    ) && (
                      <Badge
                        variant="outline"
                        className="text-xs font-semibold bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700"
                      >
                        NEMAR
                      </Badge>
                    )}
                    {/* Modality badges with distinct colors */}
                    <div className="flex items-center gap-1">
                      {dataset.summary.modalities.map((modality) => {
                        const modalityLower = modality.toLowerCase();
                        let badgeClass = "";

                        // Color scheme based on modality type
                        if (modalityLower === "eeg") {
                          badgeClass =
                            "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700";
                        } else if (modalityLower === "meg") {
                          badgeClass =
                            "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700";
                        } else if (modalityLower === "ieeg") {
                          badgeClass =
                            "bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700";
                        } else if (
                          modalityLower === "mri" ||
                          modalityLower === "anat"
                        ) {
                          badgeClass =
                            "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700";
                        } else if (
                          modalityLower === "fmri" ||
                          modalityLower === "func"
                        ) {
                          badgeClass =
                            "bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700";
                        } else if (modalityLower === "dwi") {
                          badgeClass =
                            "bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700";
                        } else if (modalityLower === "pet") {
                          badgeClass =
                            "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700";
                        } else {
                          badgeClass =
                            "bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700";
                        }

                        return (
                          <Badge
                            key={modality}
                            variant="outline"
                            className={`text-xs font-medium ${badgeClass}`}
                          >
                            {modality.toUpperCase()}
                          </Badge>
                        );
                      })}
                    </div>
                  </>
                )}
              {dataset.snapshots && dataset.snapshots.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Database className="h-3 w-3" />
                  {dataset.snapshots.length} snapshot
                  {dataset.snapshots.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenInBrowser(dataset.id);
            }}
            className="p-2 hover:bg-accent rounded-lg transition-colors"
            title="Open in browser"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  },
);

DatasetCard.displayName = "DatasetCard";

export function OpenNeuroBrowser() {
  const [allDatasets, setAllDatasets] = useState<OpenNeuroDataset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDataset, setSelectedDataset] =
    useState<OpenNeuroDataset | null>(null);
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [datasetToDownload, setDatasetToDownload] =
    useState<OpenNeuroDataset | null>(null);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasMorePages, setHasMorePages] = useState(true);
  const [modalityFilter, setModalityFilter] = useState<"all" | "nemar">("all");
  const [isAutoLoading, setIsAutoLoading] = useState(false);

  // Use TanStack Query for API key status
  const { data: apiKeyStatus } = useOpenNeuroApiKey();
  const isAuthenticated = apiKeyStatus?.has_key ?? false;

  // Use TanStack Query for datasets - fetch initial batch
  const {
    data: initialData,
    isLoading: loading,
    error: queryError,
  } = useOpenNeuroDatasetsBatch(50, undefined);

  // Set initial datasets when loaded
  useMemo(() => {
    if (initialData && allDatasets.length === 0) {
      setAllDatasets(initialData.datasets);
      setEndCursor(initialData.endCursor || undefined);
      setHasMorePages(initialData.hasNextPage);
    }
  }, [initialData]);

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Failed to load datasets"
    : null;

  // Filter datasets - apply both search query and modality filter (client-side)
  const filteredDatasets = useMemo(() => {
    let filtered = allDatasets;

    // Apply search filter (client-side on loaded datasets)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((dataset) => {
        const name = (dataset.name || dataset.id).toLowerCase();
        const id = dataset.id.toLowerCase();
        const description = (dataset.description || "").toLowerCase();

        return (
          name.includes(query) ||
          id.includes(query) ||
          description.includes(query)
        );
      });
    }

    // Apply modality filter (client-side)
    if (modalityFilter === "nemar") {
      filtered = filtered.filter((dataset) => {
        const modalities = dataset.summary?.modalities || [];
        return modalities.some((m) =>
          ["eeg", "meg", "ieeg"].includes(m.toLowerCase()),
        );
      });
    }

    return filtered;
  }, [allDatasets, modalityFilter, searchQuery]);

  const loadMoreDatasets = useCallback(async () => {
    if (!hasMorePages) return;

    try {
      console.log("[OPENNEURO] Loading more datasets...");
      const result = await openNeuroService.fetchDatasetsBatch(50, endCursor);
      console.log(`[OPENNEURO] Loaded ${result.datasets.length} more datasets`);
      setAllDatasets((prev) => [...prev, ...result.datasets]);
      setEndCursor(result.endCursor || undefined);
      setHasMorePages(result.hasNextPage);
    } catch (err) {
      console.error("[OPENNEURO] Failed to load more datasets:", err);
    }
  }, [hasMorePages, endCursor]);

  // Auto-load more datasets when searching and no results found
  useEffect(() => {
    const autoLoadMore = async () => {
      // Only auto-load if:
      // 1. There's an active search query
      // 2. No results found in current datasets
      // 3. More pages available
      // 4. Not already loading
      // 5. Initial load is complete
      if (
        searchQuery.trim() &&
        filteredDatasets.length === 0 &&
        hasMorePages &&
        !isAutoLoading &&
        !loading &&
        allDatasets.length > 0
      ) {
        console.log(
          `[OPENNEURO] Auto-loading more datasets to find "${searchQuery}"...`,
        );
        setIsAutoLoading(true);

        try {
          const result = await openNeuroService.fetchDatasetsBatch(
            50,
            endCursor,
          );
          console.log(
            `[OPENNEURO] Auto-loaded ${result.datasets.length} more datasets (total: ${allDatasets.length + result.datasets.length})`,
          );
          setAllDatasets((prev) => [...prev, ...result.datasets]);
          setEndCursor(result.endCursor || undefined);
          setHasMorePages(result.hasNextPage);
        } catch (err) {
          console.error("[OPENNEURO] Auto-load failed:", err);
        } finally {
          setIsAutoLoading(false);
        }
      }
    };

    autoLoadMore();
  }, [
    searchQuery,
    filteredDatasets.length,
    hasMorePages,
    isAutoLoading,
    loading,
    allDatasets.length,
    endCursor,
  ]);

  const handleDatasetClick = useCallback((dataset: OpenNeuroDataset) => {
    setSelectedDataset(dataset);
  }, []);

  const handleOpenInBrowser = useCallback(async (datasetId: string) => {
    const url = `https://openneuro.org/datasets/${datasetId}`;
    try {
      await open(url);
    } catch (error) {
      console.error("Failed to open URL:", error);
      window.open(url, "_blank");
    }
  }, []);

  const handleOpenInNEMAR = useCallback(async (datasetId: string) => {
    const url = `https://nemar.org/datasets/${datasetId}`;
    try {
      await open(url);
    } catch (error) {
      console.error("Failed to open URL:", error);
      window.open(url, "_blank");
    }
  }, []);

  const isNEMARDataset = useCallback((dataset: OpenNeuroDataset) => {
    const modalities = dataset.summary?.modalities || [];
    return modalities.some((m) =>
      ["eeg", "meg", "ieeg"].includes(m.toLowerCase()),
    );
  }, []);

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  const formatNumber = (num?: number) => {
    if (num === undefined || num === null) return "N/A";
    return num.toLocaleString();
  };

  return (
    <div className="flex h-full gap-4">
      {/* Left panel: Dataset list */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with search and auth status */}
        <div className="mb-4 space-y-3">
          {/* Authentication status bar */}
          <div className="flex items-center justify-between gap-2 p-3 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2 text-sm">
              <Key className="h-4 w-4 text-muted-foreground" />
              {isAuthenticated ? (
                <span className="text-primary font-medium">Authenticated</span>
              ) : (
                <span className="text-muted-foreground">
                  Not authenticated - Configure API key in Settings
                </span>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search datasets by ID or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {/* Search info message */}
            {searchQuery.trim() && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-2 rounded-lg">
                {isAutoLoading ? (
                  <>
                    <Database className="h-3 w-3 animate-pulse" />
                    <span>
                      Auto-loading datasets to find "{searchQuery}"... (
                      {allDatasets.length} searched so far)
                    </span>
                  </>
                ) : (
                  <>
                    <Search className="h-3 w-3" />
                    <span>
                      Searching {allDatasets.length} loaded datasets. Use "Load
                      More" to search additional datasets.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Modality filter toggles */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filter:</span>
            <button
              onClick={() => setModalityFilter("all")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                modalityFilter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              All Datasets
            </button>
            <button
              onClick={() => setModalityFilter("nemar")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                modalityFilter === "nemar"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              EEG/MEG/iEEG Only
            </button>
            {modalityFilter === "nemar" && (
              <span className="text-xs text-muted-foreground ml-2">
                ({filteredDatasets.length} datasets)
              </span>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive rounded-lg text-destructive">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground animate-pulse" />
              <p className="text-muted-foreground">Loading datasets...</p>
            </div>
          </div>
        )}

        {/* Dataset list */}
        {!loading && filteredDatasets.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Database
                className={`h-12 w-12 mx-auto mb-4 text-muted-foreground ${isAutoLoading ? "animate-pulse" : ""}`}
              />
              <p className="text-muted-foreground">
                {isAutoLoading
                  ? `Searching for "${searchQuery}"...`
                  : searchQuery
                    ? "No datasets found matching your search"
                    : "No datasets available"}
              </p>
              {searchQuery && hasMorePages && !isAutoLoading && (
                <p className="text-sm text-muted-foreground mt-2">
                  Try loading more datasets to continue searching
                </p>
              )}
              {isAutoLoading && (
                <p className="text-sm text-muted-foreground mt-2">
                  Loaded {allDatasets.length} datasets so far...
                </p>
              )}
            </div>
          </div>
        )}

        {!loading && filteredDatasets.length > 0 && (
          <div className="flex-1 overflow-auto space-y-2">
            {filteredDatasets.map((dataset) => (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                isSelected={selectedDataset?.id === dataset.id}
                onSelect={handleDatasetClick}
                onOpenInBrowser={handleOpenInBrowser}
              />
            ))}
          </div>
        )}

        {/* Load More button - show if more data available (regardless of search results) */}
        {!loading && hasMorePages && (
          <div className="mt-4 flex flex-col items-center gap-2">
            {searchQuery.trim() &&
              filteredDatasets.length === 0 &&
              !isAutoLoading && (
                <p className="text-xs text-muted-foreground mb-2">
                  No results in the first {allDatasets.length} datasets. Load
                  more to search additional datasets.
                </p>
              )}
            <button
              onClick={loadMoreDatasets}
              disabled={isAutoLoading}
              className={`px-6 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                isAutoLoading
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              <Database
                className={`h-4 w-4 ${isAutoLoading ? "animate-pulse" : ""}`}
              />
              {isAutoLoading ? "Auto-loading..." : "Load More Datasets"}
            </button>
          </div>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          {searchQuery.trim() ? (
            <>
              {filteredDatasets.length !== allDatasets.length ? (
                <>
                  Showing {filteredDatasets.length} of {allDatasets.length}{" "}
                  search results
                </>
              ) : (
                <>
                  Found {allDatasets.length} dataset
                  {allDatasets.length !== 1 ? "s" : ""}
                </>
              )}
            </>
          ) : (
            <>
              {allDatasets.length} dataset{allDatasets.length !== 1 ? "s" : ""}{" "}
              loaded
              {hasMorePages && " (more available)"}
            </>
          )}
        </div>
      </div>

      {/* Right panel: Dataset details */}
      {selectedDataset && (
        <div className="w-96 border-l pl-4 flex flex-col">
          <div className="mb-4">
            <h2 className="text-2xl font-bold mb-2">{selectedDataset.id}</h2>
            {selectedDataset.name &&
              selectedDataset.name !== selectedDataset.id && (
                <h3 className="text-lg text-muted-foreground mb-2">
                  {selectedDataset.name}
                </h3>
              )}
            {selectedDataset.description && (
              <p className="text-sm text-muted-foreground mb-4">
                {selectedDataset.description}
              </p>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-4 mb-6">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                Created
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                {formatDate(selectedDataset.created)}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                Modified
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                {formatDate(selectedDataset.modified)}
              </div>
            </div>

            {selectedDataset.analytics && (
              <>
                {selectedDataset.analytics.views !== undefined && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                      Views
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Eye className="h-4 w-4" />
                      {formatNumber(selectedDataset.analytics.views)}
                    </div>
                  </div>
                )}
                {selectedDataset.analytics.downloads !== undefined && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                      Downloads
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <TrendingDown className="h-4 w-4" />
                      {formatNumber(selectedDataset.analytics.downloads)}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Modalities */}
            {selectedDataset.summary?.modalities &&
              selectedDataset.summary.modalities.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Modalities
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedDataset.summary.modalities.map((modality) => (
                      <Badge
                        key={modality}
                        variant={
                          ["eeg", "meg", "ieeg"].includes(
                            modality.toLowerCase(),
                          )
                            ? "default"
                            : "secondary"
                        }
                      >
                        {modality.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                  {/* MEG Format Warning */}
                  {selectedDataset.summary.modalities.some(
                    (m) => m.toLowerCase() === "meg",
                  ) && (
                    <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-800 dark:text-amber-200">
                          <strong>Limited MEG Format Support:</strong> This
                          dataset contains MEG files (.fif, .ds, .sqd). DDALAB
                          supports FIFF (.fif) files for Neuromag/Elekta MEG
                          data. Other MEG formats (.ds, .sqd, .meg4) are not yet
                          supported.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

            {/* Subject count */}
            {selectedDataset.summary?.subjects !== undefined && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Subjects
                </div>
                <div className="text-sm">
                  {formatNumber(selectedDataset.summary.subjects)}
                </div>
              </div>
            )}
          </div>

          {/* Snapshots */}
          {selectedDataset.snapshots &&
            selectedDataset.snapshots.length > 0 && (
              <div className="mb-6">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  Snapshots ({selectedDataset.snapshots.length})
                </div>
                <div className="space-y-2 max-h-48 overflow-auto">
                  {selectedDataset.snapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="p-2 bg-accent rounded-lg text-sm"
                    >
                      <div className="font-semibold">{snapshot.tag}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(snapshot.created)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Actions */}
          <div className="mt-auto space-y-2">
            <button
              onClick={() => handleOpenInBrowser(selectedDataset.id)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              View on OpenNeuro
            </button>
            {isNEMARDataset(selectedDataset) && (
              <button
                onClick={() => handleOpenInNEMAR(selectedDataset.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                View on NEMAR
              </button>
            )}
            <button
              onClick={() => {
                setDatasetToDownload(selectedDataset);
                setIsDownloadDialogOpen(true);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors"
            >
              <Download className="h-4 w-4" />
              Download Dataset
            </button>
          </div>
        </div>
      )}

      {/* Download Dialog */}
      <OpenNeuroDownloadDialog
        isOpen={isDownloadDialogOpen}
        onClose={() => {
          setIsDownloadDialogOpen(false);
          setDatasetToDownload(null);
        }}
        dataset={datasetToDownload}
      />
    </div>
  );
}
