import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import apiService from "@/lib/api";
import { DashboardStats } from "@/types/dashboard";
import { Layout } from "@/types/layouts";
import { UserPreferences } from "@/types/user-preferences";

interface ApiState {
  dashboardStats: DashboardStats | null;
  layouts: Layout[];
  userPreferences: UserPreferences | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: ApiState = {
  dashboardStats: null,
  layouts: [],
  userPreferences: null,
  isLoading: false,
  error: null,
};

// Async thunks
export const fetchDashboardStats = createAsyncThunk(
  "api/fetchDashboardStats",
  async () => {
    const response = await apiService.getDashboardStats();
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!;
  }
);

export const fetchLayouts = createAsyncThunk("api/fetchLayouts", async () => {
  const response = await apiService.getLayouts();
  if (response.error) {
    throw new Error(response.error);
  }
  return response.data!;
});

export const saveLayouts = createAsyncThunk(
  "api/saveLayouts",
  async (layouts: Layout[]) => {
    const response = await apiService.saveLayouts(layouts);
    if (response.error) {
      throw new Error(response.error);
    }
    return layouts; // Return the layouts that were saved
  }
);

export const deleteLayouts = createAsyncThunk("api/deleteLayouts", async () => {
  const response = await apiService.deleteLayouts();
  if (response.error) {
    throw new Error(response.error);
  }
  return [];
});

export const fetchUserPreferences = createAsyncThunk(
  "api/fetchUserPreferences",
  async () => {
    const response = await apiService.getUserPreferences();
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!;
  }
);

export const updateUserPreferences = createAsyncThunk(
  "api/updateUserPreferences",
  async (preferences: Partial<UserPreferences>) => {
    const response = await apiService.updateUserPreferences(preferences);
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!;
  }
);

export const resetUserPreferences = createAsyncThunk(
  "api/resetUserPreferences",
  async () => {
    const response = await apiService.resetUserPreferences();
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!;
  }
);

const apiSlice = createSlice({
  name: "api",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setLayouts: (state, action: PayloadAction<Layout[]>) => {
      state.layouts = action.payload;
    },
    addLayout: (state, action: PayloadAction<Layout>) => {
      state.layouts.push(action.payload);
    },
    updateLayout: (
      state,
      action: PayloadAction<{ id: string; layout: Layout }>
    ) => {
      const index = state.layouts.findIndex(
        (layout) => layout.i === action.payload.id
      );
      if (index !== -1) {
        state.layouts[index] = action.payload.layout;
      }
    },
    removeLayout: (state, action: PayloadAction<string>) => {
      state.layouts = state.layouts.filter(
        (layout) => layout.i !== action.payload
      );
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchDashboardStats
      .addCase(fetchDashboardStats.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchDashboardStats.fulfilled, (state, action) => {
        state.isLoading = false;
        state.dashboardStats = action.payload;
      })
      .addCase(fetchDashboardStats.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || "Failed to fetch dashboard stats";
      })
      // fetchLayouts
      .addCase(fetchLayouts.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchLayouts.fulfilled, (state, action) => {
        state.isLoading = false;
        state.layouts = action.payload;
      })
      .addCase(fetchLayouts.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || "Failed to fetch layouts";
      })
      // saveLayouts
      .addCase(saveLayouts.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(saveLayouts.fulfilled, (state, action) => {
        state.isLoading = false;
        state.layouts = action.payload;
      })
      .addCase(saveLayouts.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || "Failed to save layouts";
      })
      // deleteLayouts
      .addCase(deleteLayouts.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(deleteLayouts.fulfilled, (state) => {
        state.isLoading = false;
        state.layouts = [];
      })
      .addCase(deleteLayouts.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || "Failed to delete layouts";
      })
      // fetchUserPreferences
      .addCase(fetchUserPreferences.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchUserPreferences.fulfilled, (state, action) => {
        state.isLoading = false;
        state.userPreferences = action.payload;
      })
      .addCase(fetchUserPreferences.rejected, (state, action) => {
        state.isLoading = false;
        state.error =
          action.error.message || "Failed to fetch user preferences";
      })
      // updateUserPreferences
      .addCase(updateUserPreferences.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(updateUserPreferences.fulfilled, (state, action) => {
        state.isLoading = false;
        state.userPreferences = action.payload;
      })
      .addCase(updateUserPreferences.rejected, (state, action) => {
        state.isLoading = false;
        state.error =
          action.error.message || "Failed to update user preferences";
      })
      // resetUserPreferences
      .addCase(resetUserPreferences.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(resetUserPreferences.fulfilled, (state, action) => {
        state.isLoading = false;
        state.userPreferences = action.payload;
      })
      .addCase(resetUserPreferences.rejected, (state, action) => {
        state.isLoading = false;
        state.error =
          action.error.message || "Failed to reset user preferences";
      });
  },
});

export const { clearError, setLayouts, addLayout, updateLayout, removeLayout } =
  apiSlice.actions;
export default apiSlice.reducer;
