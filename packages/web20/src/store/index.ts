import { configureStore } from "@reduxjs/toolkit";
import dashboardReducer from "./slices/dashboardSlice";
import userReducer from "./slices/userSlice";
import authReducer from "./slices/authSlice";
import apiReducer from "./slices/apiSlice";

export const store = configureStore({
  reducer: {
    dashboard: dashboardReducer,
    user: userReducer,
    auth: authReducer,
    api: apiReducer,
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

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
