import { gql } from "@apollo/client";

// File queries
export const LIST_FILES = gql`
  query ListFiles {
    files {
      files
    }
  }
`;

export const LIST_FILES_IN_PATH = gql`
  query ListFilesInPath($path: String!) {
    listDirectory(path: $path) {
      name
      path
      isDirectory
      size
      lastModified
    }
  }
`;

export const CHECK_FILE_EXISTS = gql`
  query CheckFileExists($filePath: String!) {
    fileExists(filePath: $filePath)
  }
`;

export const GET_FILE_HASH = gql`
  query GetFileHash($filePath: String!) {
    fileHash(filePath: $filePath) {
      hash
    }
  }
`;

// DDA queries
export const GET_DDA_TASK_STATUS = gql`
  query GetDDATaskStatus($taskId: String!) {
    ddaTaskStatus(taskId: $taskId) {
      status
    }
  }
`;

export const GET_DDA_TASK_RESULT = gql`
  query GetDDATaskResult($taskId: String!) {
    ddaTaskResult(taskId: $taskId) {
      filePath
      results
      metadata
    }
  }
`;

export const GET_EDF_DATA = gql`
  query GetEDFData(
    $filename: String!
    $chunkStart: Int
    $chunkSize: Int
    $preprocessingOptions: VisualizationPreprocessingOptionsInput
  ) {
    getEdfData(
      filename: $filename
      chunkStart: $chunkStart
      chunkSize: $chunkSize
      preprocessingOptions: $preprocessingOptions
    ) {
      data
      samplingFrequency
      channelLabels
      totalSamples
      chunkStart
      chunkSize
      hasMore
    }
  }
`;
