import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Artifact {
  artifact_id: string;
  name: string;
  file_path: string;
  created_at: string;
  user_id: number;
  shared_by_user_id?: number;
}

export interface ArtifactsState {
  artifacts: Artifact[];
  loading: boolean;
  error: string | null;
  autoFetch: boolean;
}

const initialState: ArtifactsState = {
  artifacts: [],
  loading: false,
  error: null,
  autoFetch: true,
};

const artifactsSlice = createSlice({
  name: "artifacts",
  initialState,
  reducers: {
    setArtifacts: (state, action: PayloadAction<Artifact[]>) => {
      state.artifacts = action.payload;
      state.loading = false;
      state.error = null;
    },
    addArtifact: (state, action: PayloadAction<Artifact>) => {
      state.artifacts.push(action.payload);
    },
    updateArtifact: (state, action: PayloadAction<Artifact>) => {
      const index = state.artifacts.findIndex(
        (a) => a.artifact_id === action.payload.artifact_id
      );
      if (index !== -1) {
        state.artifacts[index] = action.payload;
      }
    },
    removeArtifact: (state, action: PayloadAction<string>) => {
      state.artifacts = state.artifacts.filter(
        (a) => a.artifact_id !== action.payload
      );
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.loading = false;
    },
    clearArtifacts: (state) => {
      state.artifacts = [];
      state.loading = false;
      state.error = null;
      state.autoFetch = false;
    },
    setAutoFetch: (state, action: PayloadAction<boolean>) => {
      state.autoFetch = action.payload;
    },
  },
});

export const {
  setArtifacts,
  addArtifact,
  updateArtifact,
  removeArtifact,
  setLoading,
  setError,
  clearArtifacts,
  setAutoFetch,
} = artifactsSlice.actions;
export default artifactsSlice.reducer;
