import { gql } from "@apollo/client";

// File queries
export const LIST_FILES_IN_PATH = gql`
  query ListFilesInPath($path: String!) {
    listDirectory(path: $path) {
      name
      path
      isDirectory
      size
      lastModified
      isFavorite
    }
  }
`;

export const GET_FAVORITE_FILES = gql`
  query GetFavoriteFiles {
    getFavoriteFiles {
      id
      userId
      filePath
      createdAt
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
    getTaskStatus(taskId: $taskId) {
      taskId
      status
      info
    }
  }
`;

export const GET_DDA_TASK_RESULT = gql`
  query GetDDATaskResult($taskId: String!) {
    getDdaResult(taskId: $taskId) {
      filePath
      Q
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
    $includeNavigationInfo: Boolean!
  ) {
    getEdfData(
      filename: $filename
      chunkStart: $chunkStart
      chunkSize: $chunkSize
      preprocessingOptions: $preprocessingOptions
      includeNavigationInfo: $includeNavigationInfo
    ) {
      data
      samplingFrequency
      channelLabels
      totalSamples
      chunkStart
      chunkSize
      hasMore
      navigationInfo @include(if: $includeNavigationInfo) {
        totalSamples
        fileDurationSeconds
        numSignals
        signalLabels
        samplingFrequencies
        chunks {
          start
          end
          size
          timeSeconds
          positionSeconds
        }
      }
      chunkInfo {
        start
        end
        size
        timeSeconds
        positionSeconds
      }
    }
  }
`;

export const GET_EDF_NAVIGATION = gql`
  query GetEDFNavigation($filename: String!, $chunkSize: Int) {
    getEdfNavigation(filename: $filename, chunkSize: $chunkSize) {
      totalSamples
      fileDurationSeconds
      numSignals
      signalLabels
      samplingFrequencies
      chunks {
        start
        end
        size
        timeSeconds
        positionSeconds
      }
    }
  }
`;

export const GET_ANNOTATIONS = gql`
  query GetAnnotations($filePath: String!) {
    getAnnotations(filePath: $filePath) {
      id
      userId
      filePath
      startTime
      endTime
      text
      createdAt
      updatedAt
    }
  }
`;

export const CREATE_ANNOTATION = gql`
  mutation CreateAnnotation($annotationInput: AnnotationInput!) {
    createAnnotation(annotationInput: $annotationInput) {
      id
      userId
      filePath
      startTime
      endTime
      text
      createdAt
      updatedAt
    }
  }
`;

export const UPDATE_ANNOTATION = gql`
  mutation UpdateAnnotation($id: Int!, $annotationInput: AnnotationInput!) {
    updateAnnotation(id: $id, annotationInput: $annotationInput) {
      id
      userId
      filePath
      startTime
      endTime
      text
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_ANNOTATION = gql`
  mutation DeleteAnnotation($id: Int!) {
    deleteAnnotation(id: $id)
  }
`;

export const GET_EDF_DEFAULT_CHANNELS = gql`
  query GetEDFDefaultChannels($filename: String!, $maxChannels: Int) {
    getEdfDefaultChannels(filename: $filename, maxChannels: $maxChannels)
  }
`;

// Add new query for DDA artifact data
export const GET_DDA_ARTIFACT_DATA = gql`
  query GetDDAArtifactData($artifactPath: String!) {
    getDdaArtifactData(artifactPath: $artifactPath) {
      originalFilePath
      Q
      metadata
      userId
      createdAt
    }
  }
`;
