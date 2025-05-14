export interface EdfConfigResponse {
  id: number;
  fileHash: string;
  userId: number;
  channels: string[];
}

export interface EdfFileInfo {
  file_path: string;
  num_chunks: number;
  chunk_size: number;
  total_samples: number;
  sampling_rate: number;
  total_duration: number;
}
