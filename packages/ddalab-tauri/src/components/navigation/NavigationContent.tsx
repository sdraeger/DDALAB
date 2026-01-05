"use client";

import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
} from "react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import type { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";

// Eagerly load lightweight components
import { FileInfoCard } from "@/components/FileInfoCard";
import { BIDSContextIndicator } from "@/components/BIDSContextIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, Activity, FileText, Sparkles, Loader2 } from "lucide-react";

// Lazy load heavy components to reduce initial bundle size
// These are only loaded when their respective navigation tabs are accessed
const TimeSeriesPlotECharts = lazy(() =>
  import("@/components/TimeSeriesPlotECharts").then((mod) => ({
    default: mod.TimeSeriesPlotECharts,
  })),
);
const AnnotationsTab = lazy(() =>
  import("@/components/AnnotationsTab").then((mod) => ({
    default: mod.AnnotationsTab,
  })),
);
const StreamingView = lazy(() =>
  import("@/components/streaming").then((mod) => ({
    default: mod.StreamingView,
  })),
);
const DDAWithHistory = lazy(() =>
  import("@/components/dda/DDAWithHistory").then((mod) => ({
    default: mod.DDAWithHistory,
  })),
);
const ICAAnalysisPanel = lazy(() =>
  import("@/components/ica").then((mod) => ({ default: mod.ICAAnalysisPanel })),
);
const SettingsPanel = lazy(() =>
  import("@/components/SettingsPanel").then((mod) => ({
    default: mod.SettingsPanel,
  })),
);
const OpenNeuroBrowser = lazy(() =>
  import("@/components/OpenNeuroBrowser").then((mod) => ({
    default: mod.OpenNeuroBrowser,
  })),
);
const NSGJobManager = lazy(() =>
  import("@/components/NSGJobManager").then((mod) => ({
    default: mod.NSGJobManager,
  })),
);
const NotificationHistory = lazy(() =>
  import("@/components/NotificationHistory").then((mod) => ({
    default: mod.NotificationHistory,
  })),
);
const CollaborationPanel = lazy(() =>
  import("@/components/collaboration").then((mod) => ({
    default: mod.CollaborationPanel,
  })),
);

// Preload common tabs after initial render for faster tab switching
// This runs once when NavigationContent mounts
// Note: Components use placeholderData in their hooks so they render immediately
// while backend data loads in the background - no need to prefetch data here
function usePreloadTabs() {
  const preloadedRef = useRef(false);

  useEffect(() => {
    if (preloadedRef.current) return;
    preloadedRef.current = true;

    // Preload after a short delay to not block initial render
    const timer = setTimeout(() => {
      // Preload component bundles (these are cached after first load)
      import("@/components/SettingsPanel");
      import("@/components/collaboration");
      import("@/components/dda/DDAWithHistory");
    }, 1000);

    return () => clearTimeout(timer);
  }, []);
}

// Delayed loading fallback - only shows spinner if loading takes > 150ms
// This prevents flash of loading state on fast loads
function DelayedLoadingFallback() {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowLoading(true), 150);
    return () => clearTimeout(timer);
  }, []);

  if (!showLoading) {
    // Return empty div with same min-height to prevent layout shift
    return <div style={{ minHeight: "200px" }} />;
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 text-muted-foreground"
      style={{ minHeight: "200px" }}
      role="status"
      aria-busy="true"
    >
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      <p className="text-sm">Loading...</p>
    </div>
  );
}

interface NavigationContentProps {
  apiService: ApiService;
}

export function NavigationContent({ apiService }: NavigationContentProps) {
  // Preload commonly used tabs after initial render
  usePreloadTabs();

  const primaryNav = useAppStore((state) => state.ui.primaryNav);
  const secondaryNav = useAppStore((state) => state.ui.secondaryNav);
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);
  // Select ONLY a primitive boolean, not the entire selectedFile object
  // This prevents re-renders when the selectedFile object reference changes
  const hasSelectedFile = useAppStore(
    (state) => !!state.fileManager.selectedFile,
  );

  // Handle navigation from notification clicks
  const handleNotificationNavigate = useCallback(
    (actionType: string, _actionData: unknown) => {
      switch (actionType) {
        case "view-analysis":
          // Navigate to DDA analysis view
          setPrimaryNav("analyze");
          setSecondaryNav("dda");
          break;

        case "view-timeseries":
          // Navigate to time series view
          setPrimaryNav("explore");
          setSecondaryNav("timeseries");
          break;

        case "view-annotations":
          // Navigate to annotations view
          setPrimaryNav("explore");
          setSecondaryNav("annotations");
          break;

        case "view-file":
          // Navigate to file manager in sidebar (primary nav stays, but we could highlight the file)
          // For now, just navigate to explore/timeseries
          setPrimaryNav("explore");
          setSecondaryNav("timeseries");
          break;

        case "view-settings":
          // Navigate to settings
          setPrimaryNav("settings");
          break;

        case "view-ica":
          // Navigate to ICA analysis
          setPrimaryNav("analyze");
          setSecondaryNav("ica");
          break;

        default:
          console.warn("[NAV] Unknown notification action type:", actionType);
      }
    },
    [setPrimaryNav, setSecondaryNav],
  );

  // Overview
  if (primaryNav === "overview") {
    return (
      <div className="p-6">
        <OverviewDashboard />
      </div>
    );
  }

  // Explore
  if (primaryNav === "explore") {
    if (secondaryNav === "timeseries") {
      return (
        <div className="p-4 h-full flex flex-col gap-3">
          {hasSelectedFile ? (
            <>
              <BIDSContextIndicator variant="full" />
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ErrorBoundary>
                  <Suspense fallback={<DelayedLoadingFallback />}>
                    <TimeSeriesPlotECharts apiService={apiService} />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </>
          ) : (
            <EmptyState
              icon={Activity}
              title="No File Selected"
              description="Select a file from the sidebar to view time series data"
            />
          )}
        </div>
      );
    }

    if (secondaryNav === "annotations") {
      return (
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <AnnotationsTab />
          </Suspense>
        </div>
      );
    }

    if (secondaryNav === "streaming") {
      return (
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <StreamingView />
          </Suspense>
        </div>
      );
    }

    return (
      <ComingSoonPlaceholder
        feature={secondaryNav || "Feature"}
        category="Data Visualization"
      />
    );
  }

  // Analyze (DDA and ICA)
  if (primaryNav === "analyze") {
    // DDA tab (default)
    if (secondaryNav === "dda" || !secondaryNav) {
      return (
        <div className="h-full flex flex-col">
          {hasSelectedFile ? (
            <>
              <div className="px-4 pt-4 pb-2">
                <BIDSContextIndicator variant="breadcrumb" />
              </div>
              <div className="flex-1 min-h-0">
                <Suspense fallback={<DelayedLoadingFallback />}>
                  <DDAWithHistory apiService={apiService} />
                </Suspense>
              </div>
            </>
          ) : (
            <div className="p-4 h-full">
              <EmptyState
                icon={Brain}
                title="No File Selected"
                description="Select a file from the sidebar to run DDA analysis"
              />
            </div>
          )}
        </div>
      );
    }

    // ICA tab
    if (secondaryNav === "ica") {
      return (
        <div className="h-full flex flex-col">
          {hasSelectedFile ? (
            <>
              <div className="px-4 pt-4 pb-2">
                <BIDSContextIndicator variant="breadcrumb" />
              </div>
              <div className="flex-1 min-h-0">
                <Suspense fallback={<DelayedLoadingFallback />}>
                  <ICAAnalysisPanel apiService={apiService} />
                </Suspense>
              </div>
            </>
          ) : (
            <div className="p-4 h-full">
              <EmptyState
                icon={Sparkles}
                title="No File Selected"
                description="Select a file from the sidebar to run ICA analysis"
              />
            </div>
          )}
        </div>
      );
    }

    return (
      <ComingSoonPlaceholder
        feature={secondaryNav || "Feature"}
        category="Analysis"
      />
    );
  }

  // Data (OpenNeuro, NSG Jobs)
  if (primaryNav === "data") {
    if (secondaryNav === "openneuro" || !secondaryNav) {
      return (
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <OpenNeuroBrowser />
          </Suspense>
        </div>
      );
    }

    if (secondaryNav === "nsg-jobs") {
      return (
        <div className="p-4 h-full">
          <ErrorBoundary>
            <Suspense fallback={<DelayedLoadingFallback />}>
              <NSGJobManager />
            </Suspense>
          </ErrorBoundary>
        </div>
      );
    }

    return (
      <ComingSoonPlaceholder
        feature={secondaryNav || "Feature"}
        category="Data"
      />
    );
  }

  // Collaborate
  if (primaryNav === "collaborate") {
    return (
      <div className="h-full">
        <ErrorBoundary>
          <Suspense fallback={<DelayedLoadingFallback />}>
            <CollaborationPanel />
          </Suspense>
        </ErrorBoundary>
      </div>
    );
  }

  // Settings
  if (primaryNav === "settings") {
    return (
      <div className="p-4 h-full">
        <Suspense fallback={<DelayedLoadingFallback />}>
          <SettingsPanel />
        </Suspense>
      </div>
    );
  }

  // Notifications
  if (primaryNav === "notifications") {
    return (
      <div className="p-4 h-full">
        <Suspense fallback={<DelayedLoadingFallback />}>
          <NotificationHistory onNavigate={handleNotificationNavigate} />
        </Suspense>
      </div>
    );
  }

  return <div className="p-6">Unknown navigation state</div>;
}

function OverviewDashboard() {
  // Select ONLY the specific properties we need
  const selectedFileName = useAppStore(
    (state) => state.fileManager.selectedFile?.file_name,
  );
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const hasCurrentAnalysis = useAppStore(
    (state) => !!state.dda.currentAnalysis,
  );
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);

  const handleQuickAction = (
    primary: PrimaryNavTab,
    secondary: SecondaryNavTab | null,
  ) => {
    setPrimaryNav(primary);
    if (secondary) setSecondaryNav(secondary);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Overview</h2>
        <p className="text-muted-foreground">
          {selectedFileName
            ? `Working on: ${selectedFileName}`
            : "No file selected"}
        </p>
      </div>

      {selectedFile && (
        <>
          {/* File Information Card */}
          <FileInfoCard fileInfo={selectedFile} />

          {/* Quick Actions */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Quick Actions</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleQuickAction("explore", "timeseries")}
              >
                <CardContent className="p-6">
                  <Activity className="h-8 w-8 mb-3 text-primary" />
                  <h3 className="font-semibold mb-1">View Data</h3>
                  <p className="text-sm text-muted-foreground">
                    Explore time series visualization
                  </p>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleQuickAction("analyze", "dda")}
              >
                <CardContent className="p-6">
                  <Brain className="h-8 w-8 mb-3 text-primary" />
                  <h3 className="font-semibold mb-1">Run Analysis</h3>
                  <p className="text-sm text-muted-foreground">
                    Perform DDA analysis
                  </p>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleQuickAction("explore", "annotations")}
              >
                <CardContent className="p-6">
                  <FileText className="h-8 w-8 mb-3 text-primary" />
                  <h3 className="font-semibold mb-1">Annotations</h3>
                  <p className="text-sm text-muted-foreground">
                    {hasCurrentAnalysis
                      ? "View/edit annotations"
                      : "Add annotations"}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {!selectedFile && (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No File Selected</h3>
            <p className="text-muted-foreground">
              Select a file from the sidebar to get started
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <Icon className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-2">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function ComingSoonPlaceholder({
  feature,
  category,
}: {
  feature: string;
  category: string;
}) {
  return (
    <div className="flex items-center justify-center h-full">
      <Card className="max-w-md">
        <CardContent className="p-12 text-center">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Coming Soon</h3>
          <p className="text-muted-foreground mb-1">
            <span className="font-medium">{feature}</span> in {category}
          </p>
          <p className="text-sm text-muted-foreground">
            This feature is planned for a future release
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
