// Components
export * from "./components/ui/button";
export * from "./components/ui/input";
export * from "./components/ui/avatar";
export * from "./components/form/LoginForm";
export * from "./components/UnsavedChangesAlert";
export * from "./components/ui/ArtifactIdentifier";

// Loading components
export * from "./components/ui/loading-overlay";
export * from "./components/ui/global-loading-overlay";

// Store
export { default as store } from "./store";
export * from "./store/slices/authSlice";
export * from "./store/slices/ticketsSlice";
export * from "./store/slices/loadingSlice";

// Store types and hooks
export type { RootState } from "./store/rootReducer";
export type { AppDispatch } from "./store";
export { useAppDispatch, useAppSelector } from "./store";

// Providers
export * from "./providers/ReduxProvider";

// Utilities
export * from "./lib/utils/misc";
export * from "./lib/utils/cache";

// Hooks
export * from "./hooks/useChunkNavigation";
export * from "./hooks/useTimeWindow";
export * from "./hooks/useHeatmapData";
export * from "./hooks/useArtifactInfo";
export * from "./hooks/useWelcomeWidget";
export * from "./hooks/useSimpleDashboard";
export * from "./hooks/useLoadingManager";

// Simple Dashboard components (new clean system)
export { SimpleDashboardGrid } from "./components/dashboard/SimpleDashboardGrid";
export { SimpleDashboardToolbar } from "./components/dashboard/SimpleDashboardToolbar";
export type { SimpleWidget } from "./components/dashboard/SimpleDashboardGrid";

// Dashboard widgets
export * from "./components/dashboard/widgets/DDAWidget";
export * from "./components/dashboard/widgets/DDAHeatmapWidget";
export * from "./components/dashboard/widgets/DDALinePlotWidget";
export * from "./components/dashboard/widgets/ChartWidget";
export * from "./components/dashboard/widgets/FileBrowserWidget";

// Canvas utilities
export * from "./components/plot/canvas/eegDrawingUtils";

// Types
export * from "./types/auth";
export * from "./types/EEGData";
export * from "./types/annotation";
export * from "./types/form-props";
