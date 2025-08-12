import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface AuthState {
  user: {
    id: string;
    email: string;
    name: string;
    accessToken?: string;
  } | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  loading: false,
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    loginStart: (state) => {
      state.loading = true;
      state.error = null;
    },
    loginSuccess: (
      state,
      action: PayloadAction<{ user: AuthState["user"] }>
    ) => {
      state.user = action.payload.user;
      state.isAuthenticated = true;
      state.loading = false;
      state.error = null;
    },
    loginFailure: (state, action: PayloadAction<string>) => {
      state.loading = false;
      state.error = action.payload;
    },
    logout: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.loading = false;
      state.error = null;
    },
    setUser: (state, action: PayloadAction<{ user: AuthState["user"] }>) => {
      state.user = action.payload.user;
      state.isAuthenticated = !!action.payload.user;
    },
    // Sync reducer for popout window synchronization
    syncFromRemote: (state, action: PayloadAction<AuthState>) => {
      const incomingState = action.payload;

      // Validate incoming auth state
      if (
        !incomingState ||
        typeof incomingState.isAuthenticated !== "boolean"
      ) {
        console.warn("[AuthSync] Invalid auth state received, ignoring sync");
        return;
      }

      // For auth, we want to sync everything except loading states
      state.user = incomingState.user;
      state.isAuthenticated = incomingState.isAuthenticated;
      state.error = incomingState.error;
      // Keep local loading state
      // state.loading = state.loading;

      console.debug("[AuthSync] Updated auth state from remote");
    },
  },
});

export const { loginStart, loginSuccess, loginFailure, logout, setUser } =
  authSlice.actions;
export default authSlice.reducer;
