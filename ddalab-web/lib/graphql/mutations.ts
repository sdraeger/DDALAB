import { gql } from "@apollo/client";

// Auth mutations
export const LOGIN_USER = gql`
  mutation LoginUser($username: String!, $password: String!) {
    login(username: $username, password: $password) {
      accessToken
      tokenType
    }
  }
`;

export const CREATE_USER = gql`
  mutation CreateUser(
    $username: String!
    $password: String!
    $isSuperuser: Boolean
  ) {
    createUser(
      username: $username
      password: $password
      isSuperuser: $isSuperuser
    ) {
      accessToken
      tokenType
    }
  }
`;

// DDA mutations
export const SUBMIT_DDA_TASK = gql`
  mutation StartDDA(
    $filePath: String!
    $preprocessingOptions: PreprocessingOptionsInput
  ) {
    startDda(filePath: $filePath, preprocessingOptions: $preprocessingOptions) {
      taskId
      filePath
      status
    }
  }
`;

export const TOGGLE_FAVORITE_FILE = gql`
  mutation ToggleFavoriteFile($filePath: String!) {
    toggleFavoriteFile(filePath: $filePath)
  }
`;

// Define the input type for preprocessing options
export const PREPROCESSING_OPTIONS_INPUT = gql`
  input PreprocessingOptionsInput {
    resample1000hz: Boolean
    resample500hz: Boolean
    lowpassFilter: Boolean
    highpassFilter: Boolean
    notchFilter: Boolean
    detrend: Boolean
  }
`;
