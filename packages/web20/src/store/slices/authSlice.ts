import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import apiService from "@/lib/api";

interface User {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
  is_admin: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  authMode: "local" | "multi" | null;
  isLoading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  authMode: null,
  isLoading: false,
  error: null,
};

// Async thunks
export const getAuthMode = createAsyncThunk("auth/getAuthMode", async () => {
  const response = await apiService.getAuthMode();
  if (response.error) {
    throw new Error(response.error);
  }
  return response.data!;
});

export const login = createAsyncThunk(
  "auth/login",
  async ({ username, password }: { username: string; password: string }) => {
    const response = await apiService.login(username, password);
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!;
  }
);

export const logout = createAsyncThunk("auth/logout", async () => {
  apiService.logout();
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setAuthMode: (state, action: PayloadAction<"local" | "multi">) => {
      state.authMode = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // getAuthMode
      .addCase(getAuthMode.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(getAuthMode.fulfilled, (state, action) => {
        state.isLoading = false;
        state.authMode = action.payload.auth_mode;
        if (action.payload.current_user) {
          state.user = action.payload.current_user;
          state.isAuthenticated = true;
        }
      })
      .addCase(getAuthMode.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || "Failed to get auth mode";
      })
      // login
      .addCase(login.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.token = action.payload.access_token;
        state.isAuthenticated = true;
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || "Login failed";
      })
      // logout
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.token = null;
        state.isAuthenticated = false;
      });
  },
});

export const { clearError, setAuthMode } = authSlice.actions;
export default authSlice.reducer;
