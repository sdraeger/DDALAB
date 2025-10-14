# TanStack Query Usage Guide

This guide explains how to use TanStack Query in the DDALAB Tauri application for efficient background data loading and caching.

## Overview

TanStack Query (formerly React Query) has been integrated to handle:
- Automatic background data fetching
- Smart caching with configurable stale times
- Loading and error states
- Mutations for data updates
- Automatic cache invalidation

## Setup

The QueryClient is already configured in `src/providers/QueryProvider.tsx` and wrapped around the app in `src/app/layout.tsx`.

Default configuration:
- **Stale Time**: 5 minutes (data is considered fresh)
- **GC Time**: 10 minutes (cached data retention)
- **Refetch on Window Focus**: Disabled
- **Retry**: 2 attempts for queries, 1 for mutations

## Available Hooks

All hooks are exported from `src/hooks/useOpenNeuro.ts`:

### Query Hooks (Data Fetching)

#### `useOpenNeuroDatasets(query?: string)`
Fetches and caches all OpenNeuro datasets with optional search filtering.

```tsx
import { useOpenNeuroDatasets } from '@/hooks/useOpenNeuro';

function MyComponent() {
  const { data: datasets, isLoading, error } = useOpenNeuroDatasets();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      {datasets?.map(dataset => (
        <div key={dataset.id}>{dataset.name}</div>
      ))}
    </div>
  );
}
```

**Caching**: 10 minutes stale time, 30 minutes GC time

#### `useOpenNeuroDatasetsBatch(limit, after?)`
Fetches datasets in paginated batches for incremental loading.

```tsx
const { data, isLoading } = useOpenNeuroDatasetsBatch(50, cursorAfter);
// data: { datasets: [], hasNextPage: boolean, endCursor: string | null }
```

**Caching**: 10 minutes stale time, 30 minutes GC time

#### `useOpenNeuroDataset(datasetId, enabled?)`
Fetches detailed information for a specific dataset.

```tsx
const { data: dataset, isLoading } = useOpenNeuroDataset('ds001234', true);
```

**Caching**: 15 minutes stale time

#### `useOpenNeuroDatasetFiles(datasetId, snapshotTag?, enabled?)`
Fetches the file tree for a dataset.

```tsx
const { data: files, isLoading } = useOpenNeuroDatasetFiles(
  'ds001234',
  'v1.0.0',
  enableQuery // Control when query runs
);
```

**Caching**: 15 minutes stale time

#### `useOpenNeuroDatasetSize(datasetId, snapshotTag?, enabled?)`
Calculates total size of a dataset.

```tsx
const { data: sizeInfo, isLoading } = useOpenNeuroDatasetSize(
  'ds001234',
  'v1.0.0',
  enableQuery
);
// sizeInfo: { totalSize, fileCount, annexedSize }
```

**Caching**: 15 minutes stale time

#### `useOpenNeuroApiKey()`
Checks API key status.

```tsx
const { data: apiKeyStatus } = useOpenNeuroApiKey();
// apiKeyStatus: { has_key: boolean, key_preview?: string }
```

**Caching**: Infinite (doesn't change during session)

#### `useGitAvailable()` & `useGitAnnexAvailable()`
Check if git/git-annex are installed.

```tsx
const { data: gitAvailable } = useGitAvailable();
const { data: gitAnnexAvailable } = useGitAnnexAvailable();
```

**Caching**: Infinite (system state doesn't change)

### Mutation Hooks (Data Updates)

#### `useDownloadDataset()`
Triggers a dataset download with progress tracking.

```tsx
import { useDownloadDataset } from '@/hooks/useOpenNeuro';

function DownloadButton({ datasetId }) {
  const downloadMutation = useDownloadDataset();

  const handleDownload = () => {
    downloadMutation.mutate({
      dataset_id: datasetId,
      destination_path: '/path/to/download',
      use_github: true,
      download_annexed: true,
      snapshot_tag: 'v1.0.0'
    }, {
      onSuccess: (downloadPath) => {
        console.log('Downloaded to:', downloadPath);
      },
      onError: (error) => {
        console.error('Download failed:', error);
      }
    });
  };

  return (
    <button
      onClick={handleDownload}
      disabled={downloadMutation.isPending}
    >
      {downloadMutation.isPending ? 'Downloading...' : 'Download'}
    </button>
  );
}
```

**Auto-invalidates**: Dataset cache on success

#### `useSaveApiKey()` & `useDeleteApiKey()`
Manage OpenNeuro API keys.

```tsx
const saveKeyMutation = useSaveApiKey();
const deleteKeyMutation = useDeleteApiKey();

saveKeyMutation.mutate('my-api-key');
deleteKeyMutation.mutate();
```

**Auto-invalidates**: API key cache on success

#### `useCancelDownload()`
Cancels an in-progress download.

```tsx
const cancelMutation = useCancelDownload();
cancelMutation.mutate(datasetId);
```

## Benefits in Practice

### 1. **Automatic Background Loading**
Data fetches happen automatically when components mount. No manual `useEffect` management.

```tsx
// Before (manual):
useEffect(() => {
  loadData();
}, []);

// After (TanStack Query):
const { data } = useOpenNeuroDatasets(); // Automatic!
```

### 2. **Smart Caching**
Data is cached and reused across components. If you navigate away and back, data is instantly available from cache.

```tsx
// Component A
const { data } = useOpenNeuroDatasets(); // Fetches from API

// Component B (rendered later)
const { data } = useOpenNeuroDatasets(); // Instant! Uses cache
```

### 3. **Parallel Queries**
Multiple queries run in parallel automatically.

```tsx
const { data: datasets } = useOpenNeuroDatasets();
const { data: apiKey } = useOpenNeuroApiKey();
const { data: gitAvailable } = useGitAvailable();
// All three fetch simultaneously!
```

### 4. **Loading & Error States**
Built-in state management eliminates manual state variables.

```tsx
// Before:
const [data, setData] = useState(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

// After:
const { data, isLoading, error } = useOpenNeuroDatasets();
```

### 5. **Optimistic Updates & Cache Invalidation**
Mutations automatically update related queries.

```tsx
// When download completes, the dataset cache is automatically refreshed
const downloadMutation = useDownloadDataset();
```

### 6. **Controlled Fetching**
Use the `enabled` parameter to control when queries run.

```tsx
const [shouldFetch, setShouldFetch] = useState(false);
const { data } = useOpenNeuroDatasetSize(
  datasetId,
  snapshot,
  shouldFetch // Only fetches when true
);

<button onClick={() => setShouldFetch(true)}>
  Calculate Size
</button>
```

## DevTools

The React Query DevTools are automatically included in development mode. Press the floating icon in the bottom-left corner to:
- Inspect cached queries
- See query states (fresh, stale, fetching)
- Manually refetch or invalidate queries
- Debug cache behavior

## Migration Guide

To migrate existing async operations to TanStack Query:

1. **Identify the operation type**:
   - Data fetching → Use `useQuery` hooks
   - Data updates → Use `useMutation` hooks

2. **Replace manual state management**:
   ```tsx
   // Before
   const [data, setData] = useState(null);
   const [loading, setLoading] = useState(false);

   useEffect(() => {
     async function fetchData() {
       setLoading(true);
       const result = await service.getData();
       setData(result);
       setLoading(false);
     }
     fetchData();
   }, []);

   // After
   const { data, isLoading } = useMyQueryHook();
   ```

3. **Create custom hooks in `useOpenNeuro.ts`** following the existing patterns.

4. **Test thoroughly** to ensure caching behavior is correct.

## Best Practices

1. **Use descriptive query keys**: Follow the `openNeuroKeys` pattern for consistent cache management
2. **Set appropriate stale times**: Longer for static data, shorter for frequently changing data
3. **Use `enabled` for conditional queries**: Prevents unnecessary API calls
4. **Handle loading/error states**: Always check `isLoading` and `error`
5. **Use mutations for side effects**: Never update data in query functions
6. **Leverage cache invalidation**: Use `queryClient.invalidateQueries()` when needed

## Next Steps

Now that datasets fetching and downloading use TanStack Query, consider migrating:
- BIDS detection operations
- Annotation loading/saving
- Workflow state management
- Sync operations

Each migration will improve performance and reduce manual state management complexity.
