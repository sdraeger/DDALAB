"use client";

import { useCallback, lazy, Suspense } from "react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import type { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";

// Eagerly load lightweight components
import { FileInfoCard } from "@/components/FileInfoCard";
import { BIDSContextIndicator } from "@/components/BIDSContextIndicator";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, Activity, FileText, Sparkles, Filter } from "lucide-react";
import { LoadingPlaceholder } from "@/components/ui/loading-overlay";

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
const PreprocessingPipeline = lazy(() =>
  import("@/components/preprocessing").then((mod) => ({
    default: mod.PreprocessingPipeline,
  })),
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

// Loading fallback component using standardized LoadingPlaceholder
function LoadingFallback() {
  return <LoadingPlaceholder message="Loading..." minHeight="200px" />;
}

interface NavigationContentProps {
  apiService: ApiService;
}

export function NavigationContent({ apiService }: NavigationContentProps) {
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
          setPrimaryNav("manage");
          setSecondaryNav("settings");
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
                <Suspense fallback={<LoadingFallback />}>
                  <TimeSeriesPlotECharts apiService={apiService} />
                </Suspense>
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
          <Suspense fallback={<LoadingFallback />}>
            <AnnotationsTab />
          </Suspense>
        </div>
      );
    }

    if (secondaryNav === "preprocessing") {
      return (
        <div className="h-full flex flex-col">
          {hasSelectedFile ? (
            <>
              <div className="px-4 pt-4 pb-2">
                <BIDSContextIndicator variant="breadcrumb" />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <Suspense fallback={<LoadingFallback />}>
                  <PreprocessingPipeline />
                </Suspense>
              </div>
            </>
          ) : (
            <div className="p-4 h-full">
              <EmptyState
                icon={Filter}
                title="No File Selected"
                description="Select a file from the sidebar to configure preprocessing"
              />
            </div>
          )}
        </div>
      );
    }

    if (secondaryNav === "streaming") {
      return (
        <div className="p-4 h-full">
          <Suspense fallback={<LoadingFallback />}>
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
                <Suspense fallback={<LoadingFallback />}>
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
                <Suspense fallback={<LoadingFallback />}>
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

  // Manage
  if (primaryNav === "manage") {
    if (secondaryNav === "settings") {
      return (
        <div className="p-4 h-full">
          <Suspense fallback={<LoadingFallback />}>
            <SettingsPanel />
          </Suspense>
        </div>
      );
    }

    if (secondaryNav === "data-sources") {
      return (
        <div className="p-4 h-full">
          <Suspense fallback={<LoadingFallback />}>
            <OpenNeuroBrowser />
          </Suspense>
        </div>
      );
    }

    if (secondaryNav === "jobs") {
      return (
        <div className="p-4 h-full">
          <Suspense fallback={<LoadingFallback />}>
            <NSGJobManager />
          </Suspense>
        </div>
      );
    }
  }

  // Notifications
  if (primaryNav === "notifications") {
    return (
      <div className="p-4 h-full">
        <Suspense fallback={<LoadingFallback />}>
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
