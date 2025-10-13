import { useState, useEffect, useCallback } from 'react';
import { Search, Download, ExternalLink, Database, Calendar, Eye, TrendingDown } from 'lucide-react';
import { openNeuroService, type OpenNeuroDataset } from '../services/openNeuroService';

export function OpenNeuroBrowser() {
  const [datasets, setDatasets] = useState<OpenNeuroDataset[]>([]);
  const [filteredDatasets, setFilteredDatasets] = useState<OpenNeuroDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDataset, setSelectedDataset] = useState<OpenNeuroDataset | null>(null);

  // Load datasets on mount
  useEffect(() => {
    loadDatasets();
  }, []);

  // Filter datasets when search query changes
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredDatasets(datasets);
    } else {
      const lowerQuery = searchQuery.toLowerCase();
      const filtered = datasets.filter(dataset =>
        dataset.id.toLowerCase().includes(lowerQuery) ||
        dataset.name?.toLowerCase().includes(lowerQuery) ||
        dataset.description?.toLowerCase().includes(lowerQuery)
      );
      setFilteredDatasets(filtered);
    }
  }, [searchQuery, datasets]);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[OPENNEURO] Loading datasets...');
      const results = await openNeuroService.searchDatasets();
      console.log(`[OPENNEURO] Loaded ${results.length} datasets`);
      setDatasets(results);
      setFilteredDatasets(results);
    } catch (err) {
      console.error('[OPENNEURO] Failed to load datasets:', err);
      setError(err instanceof Error ? err.message : 'Failed to load datasets');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDatasetClick = (dataset: OpenNeuroDataset) => {
    setSelectedDataset(dataset);
  };

  const handleOpenInBrowser = (datasetId: string) => {
    const url = `https://openneuro.org/datasets/${datasetId}`;
    window.open(url, '_blank');
  };

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
        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search datasets by ID, name, or description..."
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
          <div className="flex-1 overflow-auto space-y-2">
            {filteredDatasets.map(dataset => (
              <div
                key={dataset.id}
                onClick={() => handleDatasetClick(dataset)}
                className={`p-4 border rounded-lg cursor-pointer transition-all ${
                  selectedDataset?.id === dataset.id
                    ? 'bg-primary/10 border-primary shadow-sm ring-2 ring-primary/20'
                    : 'hover:bg-accent hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-lg">{dataset.id}</div>
                    {dataset.name && (
                      <div className="text-sm font-medium text-muted-foreground mt-1">
                        {dataset.name}
                      </div>
                    )}
                    {dataset.description && (
                      <div className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {dataset.description}
                      </div>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                      {dataset.snapshots && dataset.snapshots.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Database className="h-3 w-3" />
                          {dataset.snapshots.length} snapshot{dataset.snapshots.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {dataset.analytics?.views !== undefined && (
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {formatNumber(dataset.analytics.views)} views
                        </span>
                      )}
                      {dataset.analytics?.downloads !== undefined && (
                        <span className="flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />
                          {formatNumber(dataset.analytics.downloads)} downloads
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenInBrowser(dataset.id);
                    }}
                    className="p-2 hover:bg-accent rounded-lg transition-colors"
                    title="Open in browser"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Showing {filteredDatasets.length} of {datasets.length} datasets
        </div>
      </div>

      {/* Right panel: Dataset details */}
      {selectedDataset && (
        <div className="w-96 border-l pl-4 flex flex-col">
          <div className="mb-4">
            <h2 className="text-2xl font-bold mb-2">{selectedDataset.id}</h2>
            {selectedDataset.name && (
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors"
              disabled
              title="Download functionality coming soon"
            >
              <Download className="h-4 w-4" />
              Download Dataset
            </button>
            <div className="text-xs text-center text-muted-foreground mt-2">
              Download functionality coming soon
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
