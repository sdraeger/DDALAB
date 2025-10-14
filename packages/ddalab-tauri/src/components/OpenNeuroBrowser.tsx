import { useState, useCallback, useMemo, memo } from 'react';
import { Search, Download, ExternalLink, Database, Calendar, Eye, TrendingDown, Key, Upload } from 'lucide-react';
import { openNeuroService, type OpenNeuroDataset } from '../services/openNeuroService';
import { open } from '@tauri-apps/plugin-shell';
import { OpenNeuroApiKeyDialog } from './OpenNeuroApiKeyDialog';
import { OpenNeuroDownloadDialog } from './OpenNeuroDownloadDialog';
import { useOpenNeuroDatasetsBatch, useOpenNeuroApiKey } from '../hooks/useOpenNeuro';

// Memoized dataset card component to prevent unnecessary re-renders
const DatasetCard = memo(({
  dataset,
  isSelected,
  onSelect,
  onOpenInBrowser
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
          ? 'bg-primary/10 border-primary shadow-sm ring-2 ring-primary/20'
          : 'hover:bg-accent hover:shadow-sm'
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
          {dataset.snapshots && dataset.snapshots.length > 0 && (
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                {dataset.snapshots.length} snapshot{dataset.snapshots.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
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
});

DatasetCard.displayName = 'DatasetCard';

export function OpenNeuroBrowser() {
  const [allDatasets, setAllDatasets] = useState<OpenNeuroDataset[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDataset, setSelectedDataset] = useState<OpenNeuroDataset | null>(null);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [datasetToDownload, setDatasetToDownload] = useState<OpenNeuroDataset | null>(null);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasMorePages, setHasMorePages] = useState(true);

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

  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to load datasets') : null;

  // Filter datasets using memoization with debouncing effect
  const filteredDatasets = useMemo(() => {
    if (searchQuery.trim() === '') {
      return allDatasets;
    }

    const lowerQuery = searchQuery.toLowerCase();
    return allDatasets.filter(dataset =>
      dataset.id.toLowerCase().includes(lowerQuery) ||
      dataset.name?.toLowerCase().includes(lowerQuery)
    );
  }, [searchQuery, allDatasets]);

  const loadMoreDatasets = useCallback(async () => {
    if (!hasMorePages) return;

    try {
      console.log('[OPENNEURO] Loading more datasets...');
      const result = await openNeuroService.fetchDatasetsBatch(50, endCursor);
      console.log(`[OPENNEURO] Loaded ${result.datasets.length} more datasets`);
      setAllDatasets(prev => [...prev, ...result.datasets]);
      setEndCursor(result.endCursor || undefined);
      setHasMorePages(result.hasNextPage);
    } catch (err) {
      console.error('[OPENNEURO] Failed to load more datasets:', err);
    }
  }, [hasMorePages, endCursor]);

  const handleDatasetClick = useCallback((dataset: OpenNeuroDataset) => {
    setSelectedDataset(dataset);
  }, []);

  const handleOpenInBrowser = useCallback(async (datasetId: string) => {
    const url = `https://openneuro.org/datasets/${datasetId}`;
    try {
      await open(url);
    } catch (error) {
      console.error('Failed to open URL:', error);
      window.open(url, '_blank');
    }
  }, []);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const formatNumber = (num?: number) => {
    if (num === undefined || num === null) return 'N/A';
    return num.toLocaleString();
  };

  return (
    <div className="flex h-full gap-4">
      {/* Left panel: Dataset list */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with search and auth status */}
        <div className="mb-4 space-y-3">
          {/* Authentication status bar */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Key className="h-4 w-4 text-muted-foreground" />
              {isAuthenticated ? (
                <span className="text-primary font-medium">Authenticated</span>
              ) : (
                <span className="text-muted-foreground">Not authenticated</span>
              )}
            </div>
            <button
              onClick={() => setIsApiKeyDialogOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 rounded-lg transition-colors"
            >
              <Key className="h-4 w-4" />
              {isAuthenticated ? 'Manage API Key' : 'Add API Key'}
            </button>
          </div>

          {/* Search bar */}
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
              <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No datasets found matching your search' : 'No datasets available'}
              </p>
            </div>
          </div>
        )}

        {!loading && filteredDatasets.length > 0 && (
          <>
            <div className="flex-1 overflow-auto space-y-2">
              {filteredDatasets.map(dataset => (
                <DatasetCard
                  key={dataset.id}
                  dataset={dataset}
                  isSelected={selectedDataset?.id === dataset.id}
                  onSelect={handleDatasetClick}
                  onOpenInBrowser={handleOpenInBrowser}
                />
              ))}
            </div>

            {/* Load More button - only show if not searching and more data available */}
            {!searchQuery && hasMorePages && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={loadMoreDatasets}
                  className="px-6 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Database className="h-4 w-4" />
                  Load More Datasets
                </button>
              </div>
            )}
          </>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          {searchQuery && filteredDatasets.length !== allDatasets.length ? (
            <>Showing {filteredDatasets.length} of {allDatasets.length} datasets</>
          ) : (
            <>
              {allDatasets.length} dataset{allDatasets.length !== 1 ? 's' : ''} loaded
              {hasMorePages && !searchQuery && ' (more available)'}
            </>
          )}
        </div>
      </div>

      {/* Right panel: Dataset details */}
      {selectedDataset && (
        <div className="w-96 border-l pl-4 flex flex-col">
          <div className="mb-4">
            <h2 className="text-2xl font-bold mb-2">{selectedDataset.id}</h2>
            {selectedDataset.name && selectedDataset.name !== selectedDataset.id && (
              <h3 className="text-lg text-muted-foreground mb-2">{selectedDataset.name}</h3>
            )}
            {selectedDataset.description && (
              <p className="text-sm text-muted-foreground mb-4">{selectedDataset.description}</p>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-4 mb-6">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Created</div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                {formatDate(selectedDataset.created)}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Modified</div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                {formatDate(selectedDataset.modified)}
              </div>
            </div>

            {selectedDataset.analytics && (
              <>
                {selectedDataset.analytics.views !== undefined && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Views</div>
                    <div className="flex items-center gap-2 text-sm">
                      <Eye className="h-4 w-4" />
                      {formatNumber(selectedDataset.analytics.views)}
                    </div>
                  </div>
                )}
                {selectedDataset.analytics.downloads !== undefined && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Downloads</div>
                    <div className="flex items-center gap-2 text-sm">
                      <TrendingDown className="h-4 w-4" />
                      {formatNumber(selectedDataset.analytics.downloads)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Snapshots */}
          {selectedDataset.snapshots && selectedDataset.snapshots.length > 0 && (
            <div className="mb-6">
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Snapshots ({selectedDataset.snapshots.length})
              </div>
              <div className="space-y-2 max-h-48 overflow-auto">
                {selectedDataset.snapshots.map(snapshot => (
                  <div key={snapshot.id} className="p-2 bg-accent rounded-lg text-sm">
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

      {/* API Key Management Dialog */}
      <OpenNeuroApiKeyDialog
        isOpen={isApiKeyDialogOpen}
        onClose={() => setIsApiKeyDialogOpen(false)}
        onApiKeyUpdated={() => {}}
      />

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
