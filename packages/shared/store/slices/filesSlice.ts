import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number | null;
  isFavorite: boolean;
  lastModified: string;
  extension?: string;
}

export interface FilesState {
  files: FileItem[];
  currentPath: string;
  isLoading: boolean;
  error: string | null;
  selectedFile?: string;
}

const initialState: FilesState = {
  files: [],
  currentPath: "",
  isLoading: false,
  error: null,
};

export const fetchFiles = createAsyncThunk(
  "files/fetchFiles",
  async (path: string, { rejectWithValue }) => {
    try {
      const { apiRequest } = await import("../../lib/utils/request");
      const { snakeToCamel } = await import("../../lib/utils/caseConverter");
      
      console.log("[fetchFiles] Making API request for path:", path);
      
      const response = await apiRequest({
        url: `/api/files/list?path=${encodeURIComponent(path)}`,
        method: "GET",
        responseType: "json",
      });
      
      const converted = snakeToCamel(response);
      
      console.log("[fetchFiles] Response received:", {
        filesCount: converted.files?.length || 0,
        currentPath: path,
        files: converted.files?.slice(0, 3) || [], // Log first 3 files
      });
      
      return {
        files: converted.files || [],
        currentPath: path,
      };
    } catch (error) {
      console.error("[fetchFiles] Error loading files:", error);
      return rejectWithValue(error instanceof Error ? error.message : 'Failed to load files');
    }
  }
);

const filesSlice = createSlice({
  name: "files",
  initialState,
  reducers: {
    setCurrentPath: (state, action: PayloadAction<string>) => {
      state.currentPath = action.payload;
    },
    setSelectedFile: (state, action: PayloadAction<string | undefined>) => {
      state.selectedFile = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    clearFiles: (state) => {
      state.files = [];
      state.currentPath = "";
      state.selectedFile = undefined;
    },
    // Sync reducer for popout window synchronization
    syncFromRemote: (state, action: PayloadAction<FilesState>) => {
      const incomingState = action.payload;

      if (!incomingState || typeof incomingState !== "object") {
        console.warn("[FilesSync] Invalid files state received, ignoring sync");
        return;
      }

      // Sync file data but preserve local loading states
      state.files = incomingState.files;
      state.currentPath = incomingState.currentPath;
      state.selectedFile = incomingState.selectedFile;
      state.error = incomingState.error;
      // Keep local loading state
      // state.isLoading = state.isLoading;

      console.debug("[FilesSync] Files state synced from remote");
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFiles.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchFiles.fulfilled, (state, action) => {
        state.isLoading = false;
        state.files = action.payload.files;
        state.currentPath = action.payload.currentPath;
      })
      .addCase(fetchFiles.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.files = [];
      });
  },
});

export const {
  setCurrentPath,
  setSelectedFile,
  clearError,
  clearFiles,
} = filesSlice.actions;

// Selectors
export const selectFiles = (state: { files: FilesState }) => state.files.files;
export const selectCurrentPath = (state: { files: FilesState }) => state.files.currentPath;
export const selectSelectedFile = (state: { files: FilesState }) => state.files.selectedFile;
export const selectFilesLoading = (state: { files: FilesState }) => state.files.isLoading;
export const selectFilesError = (state: { files: FilesState }) => state.files.error;

export default filesSlice.reducer;