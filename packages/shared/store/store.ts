import { configureStore } from "@reduxjs/toolkit";
import rootReducer, { RootState } from "./rootReducer";

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types, or customize for specific paths
        ignoredActions: [
          "plots/initialize/fulfilled", // Payload may contain complex objects or Date
          "plots/loadChunk/fulfilled", // Payload may contain complex objects or Date
          // Add other action types if they have non-serializable payloads
        ],
        // Ignore these paths in the state
        ignoredPaths: [
          "plots.*.edfData", // EEGData can be large and complex
          "plots.*.metadata", // Can contain various types from EdfFileInfo
          "plots.*.annotations", // Annotations can be complex
        ],
      },
    }),
  devTools: process.env.NODE_ENV !== "production",
});

export type AppDispatch = typeof store.dispatch;
export default store;

// Helper hooks - consider placing these in a separate hooks.ts file within the store directory
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
