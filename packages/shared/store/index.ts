import { configureStore } from "@reduxjs/toolkit";
import { persistStore, persistReducer } from "redux-persist";
import storage from "redux-persist/lib/storage";
import rootReducer, { RootState } from "./rootReducer";
import { TypedUseSelectorHook, useSelector } from "react-redux";
import { useDispatch } from "react-redux";

// Configure persistence for plot data
const persistConfig = {
  key: "ddalab-root",
  storage,
  whitelist: ["plots"], // Only persist plots state
  // Transform the data to handle non-serializable values
  transforms: [
    {
      // Custom transform to handle EEGData serialization
      in: (state: any) => {
        if (!state) return state;

        // Deep clone and transform the state
        const transformedState = JSON.parse(
          JSON.stringify(state, (key, value) => {
            // Handle Date objects
            if (value && typeof value === "object" && value.startTime) {
              return {
                ...value,
                startTime:
                  typeof value.startTime === "string"
                    ? value.startTime
                    : value.startTime.toISOString(),
              };
            }
            return value;
          })
        );

        return transformedState;
      },
      out: (state: any) => {
        if (!state) return state;

        // Transform back from storage
        const transformedState = JSON.parse(
          JSON.stringify(state, (key, value) => {
            // Handle Date objects
            if (value && typeof value === "object" && value.startTime) {
              return {
                ...value,
                startTime: new Date(value.startTime),
              };
            }
            return value;
          })
        );

        return transformedState;
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
          "plots.*.edfData",
          "plots.*.metadata",
          "plots.*.annotations",
        ],
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
