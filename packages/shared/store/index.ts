import { configureStore } from "@reduxjs/toolkit";
import { persistStore, persistReducer } from "redux-persist";
import storage from "redux-persist/lib/storage";
import rootReducer, { RootState } from "./rootReducer";
import { TypedUseSelectorHook, useSelector } from "react-redux";
import { useDispatch } from "react-redux";
import { indexedDBStorage } from "../lib/utils/indexedDB/indexedDBStorage";

// Configure persistence with hybrid storage
const persistConfig = {
  key: "ddalab-root",
  storage: indexedDBStorage, // Use our custom storage engine
  whitelist: ["auth", "tickets", "artifacts", "loading"], // Remove plots from whitelist to prevent quota issues
  // Transform to exclude large data from persistence but keep metadata
  transforms: [
    {
      in: (state: any) => {
        // Keep everything except the actual EEG data arrays
        if (state.plots) {
          const transformedPlots = { ...state.plots };
          Object.keys(transformedPlots).forEach((filePath) => {
            if (transformedPlots[filePath]?.edfData) {
              // Keep metadata but remove the large data arrays
              transformedPlots[filePath] = {
                ...transformedPlots[filePath],
                edfData: {
                  ...transformedPlots[filePath].edfData,
                  data: null, // Don't persist the large data arrays
                },
              };
            }
          });
          return { ...state, plots: transformedPlots };
        }
        return state;
      },
      out: (state: any) => {
        // Restore the state as-is (data will be reloaded from IndexedDB)
        return state;
      },
    },
  ],
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          "plots/initialize/fulfilled",
          "plots/loadChunk/fulfilled",
          "persist/PERSIST",
          "persist/REHYDRATE",
        ],
        ignoredPaths: [
          "plots.*.edfData.data",
          "plots.*.edfData",
          "plots.*.metadata",
          "plots.*.annotations",
        ],
        // Add more specific ignores for large data
        ignoredActionPaths: ["payload.edfData.data", "payload.eegData.data"],
      },
      // Increase the warning threshold for large state
      immutableCheck: {
        warnAfter: 128,
      },
    }),
  devTools: process.env.NODE_ENV !== "production",
});

export const persistor = persistStore(store);

export type AppDispatch = typeof store.dispatch;
export type AppState = RootState;

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<AppState> = useSelector;

export default store;
