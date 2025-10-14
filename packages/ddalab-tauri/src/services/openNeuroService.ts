import { GraphQLClient, gql } from 'graphql-request';
import { invoke } from '@tauri-apps/api/core';

const OPENNEURO_GRAPHQL_ENDPOINT = 'https://openneuro.org/crn/graphql';

// Types for OpenNeuro data structures
export interface ApiKeyStatus {
  has_key: boolean;
  key_preview?: string;
}

export interface DownloadProgress {
  dataset_id: string;
  phase: 'cloning' | 'fetching' | 'completed' | 'error';
  progress_percent: number;
  message: string;
  current_file?: string;
}

export interface DownloadOptions {
  dataset_id: string;
  destination_path: string;
  use_github: boolean;
  download_annexed: boolean;
  snapshot_tag?: string;
}

export interface OpenNeuroDataset {
  id: string;
  name?: string;
  description?: string;
  created?: string;
  modified?: string;
  public?: boolean;
  snapshots?: OpenNeuroSnapshot[];
  draft?: {
    modified?: string;
  };
  analytics?: {
    downloads?: number;
    views?: number;
  };
}

export interface OpenNeuroSnapshot {
  id: string;
  tag: string;
  created?: string;
  description?: string;
}

export interface OpenNeuroFile {
  filename: string;
  size?: number;
  directory?: boolean;
  annexed?: boolean;
}

export interface SearchDatasetsResult {
  datasets: {
    edges: Array<{
      node: OpenNeuroDataset;
    }>;
  };
}

export interface GetDatasetResult {
  dataset: OpenNeuroDataset;
}

export interface GetDatasetFilesResult {
  dataset: {
    draft?: {
      files: OpenNeuroFile[];
    };
    snapshot?: {
      files: OpenNeuroFile[];
    };
  };
}

class OpenNeuroService {
  private client: GraphQLClient;
  private apiKey: string | null = null;

  constructor() {
    this.client = new GraphQLClient(OPENNEURO_GRAPHQL_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.loadApiKey();
  }

  private async loadApiKey(): Promise<void> {
    try {
      const key = await invoke<string>('get_openneuro_api_key');
      this.apiKey = key;
      this.updateClientHeaders();
    } catch (error) {
      console.log('[OPENNEURO] No API key found in keyring');
      this.apiKey = null;
    }
  }

  private updateClientHeaders(): void {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    this.client = new GraphQLClient(OPENNEURO_GRAPHQL_ENDPOINT, { headers });
  }

  async saveApiKey(apiKey: string): Promise<void> {
    await invoke('save_openneuro_api_key', { apiKey });
    this.apiKey = apiKey;
    this.updateClientHeaders();
  }

  async getApiKey(): Promise<string | null> {
    try {
      return await invoke<string>('get_openneuro_api_key');
    } catch (error) {
      return null;
    }
  }

  async checkApiKey(): Promise<ApiKeyStatus> {
    try {
      return await invoke<ApiKeyStatus>('check_openneuro_api_key');
    } catch (error) {
      return { has_key: false };
    }
  }

  async deleteApiKey(): Promise<void> {
    await invoke('delete_openneuro_api_key');
    this.apiKey = null;
    this.updateClientHeaders();
  }

  isAuthenticated(): boolean {
    return this.apiKey !== null;
  }

  async checkGitAvailable(): Promise<boolean> {
    try {
      return await invoke<boolean>('check_git_available');
    } catch (error) {
      console.error('Failed to check git availability:', error);
      return false;
    }
  }

  async checkGitAnnexAvailable(): Promise<boolean> {
    try {
      return await invoke<boolean>('check_git_annex_available');
    } catch (error) {
      console.error('Failed to check git-annex availability:', error);
      return false;
    }
  }

  async downloadDataset(options: DownloadOptions): Promise<string> {
    return await invoke<string>('download_openneuro_dataset', { options });
  }

  async cancelDownload(datasetId: string): Promise<void> {
    await invoke('cancel_openneuro_download', { datasetId });
  }

  // Search datasets (no authentication required)
  // Fetches datasets in batches with pagination support
  async searchDatasets(query?: string): Promise<OpenNeuroDataset[]> {
    const allDatasets: OpenNeuroDataset[] = [];
    let hasNextPage = true;
    let afterCursor: string | null = null;

    try {
      console.log('[OPENNEURO] Starting paginated dataset fetch...');

      while (hasNextPage) {
        const searchQuery = gql`
          query PublicDatasets($after: String) {
            datasets(first: 100, after: $after) {
              edges {
                cursor
                node {
                  id
                  latestSnapshot {
                    tag
                    created
                    description {
                      Name
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `;

        let data: any;
        try {
          data = await this.client.request<any>(searchQuery, { after: afterCursor });
        } catch (error: any) {
          // Handle partial errors - OpenNeuro returns data even with errors for some datasets
          if (error.response?.data?.datasets) {
            console.warn('[OPENNEURO] Partial error in batch, continuing with available data:', error.response.errors?.[0]?.message);
            data = error.response.data;
          } else {
            throw error;
          }
        }

        // Transform and add to results, filtering out null entries and datasets without snapshots
        const batch: OpenNeuroDataset[] = data.datasets.edges
          .filter((edge: any) => edge !== null && edge.node && edge.node.latestSnapshot) // Skip null entries and null snapshots
          .map((edge: any) => ({
            id: edge.node.id,
            name: edge.node.latestSnapshot?.description?.Name || edge.node.id,
            description: '', // Not available in list view
            created: edge.node.latestSnapshot?.created,
            public: true,
            snapshots: [{
              id: edge.node.latestSnapshot.tag,
              tag: edge.node.latestSnapshot.tag,
              created: edge.node.latestSnapshot.created,
            }],
          }));

        allDatasets.push(...batch);

        // Update pagination state
        hasNextPage = data.datasets.pageInfo.hasNextPage;
        afterCursor = data.datasets.pageInfo.endCursor;

        console.log(`[OPENNEURO] Fetched ${batch.length} datasets (total: ${allDatasets.length})`);

        // Safety limit to prevent infinite loops
        if (allDatasets.length > 10000) {
          console.warn('[OPENNEURO] Hit safety limit of 10000 datasets');
          break;
        }
      }

      console.log(`[OPENNEURO] Finished! Total datasets: ${allDatasets.length}`);

      // Filter by query if provided
      if (query && query.trim()) {
        const lowerQuery = query.toLowerCase();
        return allDatasets.filter(dataset =>
          dataset.id.toLowerCase().includes(lowerQuery) ||
          dataset.name?.toLowerCase().includes(lowerQuery)
        );
      }

      return allDatasets;
    } catch (error) {
      console.error('Failed to search datasets:', error);
      throw error;
    }
  }

  // Fetch datasets in a single batch (for incremental loading)
  async fetchDatasetsBatch(limit: number = 50, after?: string): Promise<{
    datasets: OpenNeuroDataset[];
    hasNextPage: boolean;
    endCursor: string | null;
  }> {
    const searchQuery = gql`
      query PublicDatasets($after: String, $first: Int!) {
        datasets(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              latestSnapshot {
                tag
                created
                description {
                  Name
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      let data: any;
      try {
        data = await this.client.request<any>(searchQuery, { after: after || null, first: limit });
      } catch (error: any) {
        // Handle partial errors
        if (error.response?.data?.datasets) {
          console.warn('[OPENNEURO] Partial error in batch:', error.response.errors?.[0]?.message);
          data = error.response.data;
        } else {
          throw error;
        }
      }

      const datasets: OpenNeuroDataset[] = data.datasets.edges
        .filter((edge: any) => edge !== null && edge.node && edge.node.latestSnapshot)
        .map((edge: any) => ({
          id: edge.node.id,
          name: edge.node.latestSnapshot?.description?.Name || edge.node.id,
          description: '',
          created: edge.node.latestSnapshot?.created,
          public: true,
          snapshots: [{
            id: edge.node.latestSnapshot.tag,
            tag: edge.node.latestSnapshot.tag,
            created: edge.node.latestSnapshot.created,
          }],
        }));

      return {
        datasets,
        hasNextPage: data.datasets.pageInfo.hasNextPage,
        endCursor: data.datasets.pageInfo.endCursor,
      };
    } catch (error) {
      console.error('Failed to fetch datasets batch:', error);
      throw error;
    }
  }

  // Get detailed dataset information
  async getDataset(datasetId: string): Promise<OpenNeuroDataset> {
    const datasetQuery = gql`
      query GetDataset($id: ID!) {
        dataset(id: $id) {
          id
          latestSnapshot {
            tag
            created
            description {
              Name
              BIDSVersion
              DatasetDOI
            }
          }
          snapshots {
            edges {
              node {
                id
                tag
                created
              }
            }
          }
          draft {
            modified
          }
        }
      }
    `;

    try {
      const data = await this.client.request<any>(datasetQuery, { id: datasetId });
      const node = data.dataset;

      return {
        id: node.id,
        name: node.latestSnapshot?.description?.Name || node.id,
        description: node.latestSnapshot?.description?.BIDSVersion ?
          `BIDS ${node.latestSnapshot.description.BIDSVersion}` : '',
        created: node.latestSnapshot?.created,
        modified: node.draft?.modified,
        public: true,
        snapshots: node.snapshots?.edges?.map((edge: any) => ({
          id: edge.node.id,
          tag: edge.node.tag,
          created: edge.node.created,
        })) || [],
      };
    } catch (error) {
      console.error(`Failed to get dataset ${datasetId}:`, error);
      throw error;
    }
  }

  // Calculate total size of dataset
  async getDatasetSize(datasetId: string, snapshotTag?: string): Promise<{ totalSize: number; fileCount: number; annexedSize: number }> {
    try {
      const files = await this.getDatasetFiles(datasetId, snapshotTag);

      let totalSize = 0;
      let annexedSize = 0;
      let fileCount = 0;

      for (const file of files) {
        if (!file.directory && file.size) {
          totalSize += file.size;
          fileCount++;

          if (file.annexed) {
            annexedSize += file.size;
          }
        }
      }

      return {
        totalSize,
        fileCount,
        annexedSize,
      };
    } catch (error) {
      console.error(`Failed to calculate size for dataset ${datasetId}:`, error);
      return {
        totalSize: 0,
        fileCount: 0,
        annexedSize: 0,
      };
    }
  }

  // Get file tree for a dataset snapshot
  async getDatasetFiles(datasetId: string, snapshotTag?: string): Promise<OpenNeuroFile[]> {
    const filesQuery = snapshotTag
      ? gql`
          query GetSnapshotFiles($id: ID!, $tag: String!) {
            dataset(id: $id) {
              snapshot(tag: $tag) {
                files {
                  filename
                  size
                  directory
                  annexed
                }
              }
            }
          }
        `
      : gql`
          query GetDraftFiles($id: ID!) {
            dataset(id: $id) {
              draft {
                files {
                  filename
                  size
                  directory
                  annexed
                }
              }
            }
          }
        `;

    try {
      const data = await this.client.request<GetDatasetFilesResult>(
        filesQuery,
        snapshotTag ? { id: datasetId, tag: snapshotTag } : { id: datasetId }
      );

      if (snapshotTag) {
        return data.dataset.snapshot?.files || [];
      } else {
        return data.dataset.draft?.files || [];
      }
    } catch (error) {
      console.error(`Failed to get files for dataset ${datasetId}:`, error);
      throw error;
    }
  }

  // Get GitHub URL for downloading via git
  getGitHubUrl(datasetId: string): string {
    return `https://github.com/OpenNeuroDatasets/${datasetId}.git`;
  }

  // Get direct download URL for a specific snapshot
  getSnapshotDownloadUrl(datasetId: string, snapshotTag: string): string {
    return `https://openneuro.org/crn/datasets/${datasetId}/snapshots/${snapshotTag}/download`;
  }
}

// Export singleton instance
export const openNeuroService = new OpenNeuroService();
