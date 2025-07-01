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
export * from "./hooks/usePersistentDashboard";
export * from "./hooks/useModernDashboard";

// Modern Dashboard Components
export * from "./components/dashboard/ModernDashboardGrid";
export * from "./components/dashboard/ModernDashboardToolbar";
export * from "./components/dashboard/ModernWidgetContainer";

// Services
export * from "./services/WidgetFactoryService";
export * from "./services/LayoutPersistenceService";

// Types
export * from "./types/dashboard";

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

// Export components
export * from "./components/providers";
export * from "./components/theme/ThemeProvider";
export * from "./components/theme/ThemeInitializer";
export * from "./components/settings/ThemeSettings";
export * from "./components/settings/EEGZoomSettings";
export * from "./components/ModeToggle";
export * from "./components/higher-order/ProtectedRoute";
export * from "./components/higher-order/ApolloWrapper";
export * from "./components/layout/Footer";
export * from "./components/layout/DashboardSidebar";
export * from "./components/layout/DashboardTabs";
export * from "./components/layout/Header";
export * from "./components/form/DDAForm";
export * from "./components/form/ResultsForm";
export * from "./components/files/FileBrowser";
export * from "./components/files/CompactFileBrowser";
export * from "./components/files/FileActionButton";
export * from "./components/plot/DDAPlot";
export * from "./components/plot/DDAHeatmap";
export * from "./components/plot/EEGChart";
export * from "./components/dialog/EDFPlotDialog";
export * from "./components/dialog/PreprocessingDialog";
export * from "./components/dialog/ShareArtifactDialog";
export * from "./components/DDAResults";

// Export hooks that exist
export * from "./hooks/useAnnotationManagement";
export * from "./hooks/useApiQuery";

// Export contexts that exist
export * from "./contexts/DashboardStateContext";
export * from "./contexts/EDFPlotContext";
export * from "./contexts/PersistentPlotsContext";

// Export utilities that exist
export * from "./lib/utils/edf-time-utils";

// Export store
export * from "./store";
