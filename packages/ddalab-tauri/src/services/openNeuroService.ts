import { GraphQLClient, gql } from 'graphql-request';

const OPENNEURO_GRAPHQL_ENDPOINT = 'https://openneuro.org/crn/graphql';

// Types for OpenNeuro data structures
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

  constructor() {
    this.client = new GraphQLClient(OPENNEURO_GRAPHQL_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // Search datasets (no authentication required)
  async searchDatasets(query?: string): Promise<OpenNeuroDataset[]> {
    const searchQuery = gql`
      query SearchDatasets {
        datasets {
          edges {
            node {
              id
              name
              description
              created
              modified
              public
              analytics {
                downloads
                views
              }
              snapshots {
                id
                tag
                created
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.client.request<SearchDatasetsResult>(searchQuery);
      let datasets = data.datasets.edges.map(edge => edge.node);

      // Filter by query if provided
      if (query && query.trim()) {
        const lowerQuery = query.toLowerCase();
        datasets = datasets.filter(dataset =>
          dataset.id.toLowerCase().includes(lowerQuery) ||
          dataset.name?.toLowerCase().includes(lowerQuery) ||
          dataset.description?.toLowerCase().includes(lowerQuery)
        );
      }

      return datasets;
    } catch (error) {
      console.error('Failed to search datasets:', error);
      throw error;
    }
  }

  // Get detailed dataset information
  async getDataset(datasetId: string): Promise<OpenNeuroDataset> {
    const datasetQuery = gql`
      query GetDataset($id: ID!) {
        dataset(id: $id) {
          id
          name
          description
          created
          modified
          public
          snapshots {
            id
            tag
            created
            description
          }
          draft {
            modified
          }
          analytics {
            downloads
            views
          }
        }
      }
    `;

    try {
      const data = await this.client.request<GetDatasetResult>(datasetQuery, { id: datasetId });
      return data.dataset;
    } catch (error) {
      console.error(`Failed to get dataset ${datasetId}:`, error);
      throw error;
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
