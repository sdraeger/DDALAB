import { configureStore } from "@reduxjs/toolkit";
import dashboardReducer from "./slices/dashboardSlice";
import userReducer from "./slices/userSlice";
import authReducer from "./slices/authSlice";
import apiReducer from "./slices/apiSlice";
import plotsReducer from "./slices/plotSlice";
import notificationsReducer from "./slices/notificationsSlice";
import type { PlotsState } from "./slices/plotSlice";

// Define the complete RootState type
export interface RootState {
  dashboard: ReturnType<typeof dashboardReducer>;
  user: ReturnType<typeof userReducer>;
  auth: ReturnType<typeof authReducer>;
  api: ReturnType<typeof apiReducer>;
  plots: PlotsState;
  notifications: ReturnType<typeof notificationsReducer>;
}

export const store = configureStore({
  reducer: {
    dashboard: dashboardReducer,
    user: userReducer,
    auth: authReducer,
    api: apiReducer,
    plots: plotsReducer,
    notifications: notificationsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ["persist/PERSIST", "persist/REHYDRATE"],
        ignoredPaths: ["dashboard.dragState", "dashboard.resizeState"],
      },
      immutableCheck: {
        ignoredPaths: ["dashboard.dragState", "dashboard.resizeState"],
      },
    }),
  devTools: process.env.NODE_ENV !== "production",
});

export type AppDispatch = typeof store.dispatch;
