"use client";

import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  memo,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import type { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";

// Eagerly load lightweight components
import { FileInfoCard } from "@/components/FileInfoCard";
import { BIDSContextIndicator } from "@/components/BIDSContextIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Card, CardContent } from "@/components/ui/card";
import {
  Brain,
  Activity,
  FileText,
  Sparkles,
  Loader2,
  GraduationCap,
  Download,
  FileSearch,
} from "lucide-react";

/**
 * MountedView - Keeps children mounted but hidden when inactive.
 * This preserves component state (chart instances, scroll positions, etc.)
 * across tab switches instead of unmounting/remounting.
 */
interface MountedViewProps {
  isActive: boolean;
  children: ReactNode;
  /** Only render after first activation (lazy mount) */
  lazyMount?: boolean;
}

function MountedView({
  isActive,
  children,
  lazyMount = true,
}: MountedViewProps) {
  const hasBeenActiveRef = useRef(isActive);

  // Track if this view has ever been active
  if (isActive && !hasBeenActiveRef.current) {
    hasBeenActiveRef.current = true;
  }

  // If lazyMount is enabled, don't render until first activation
  if (lazyMount && !hasBeenActiveRef.current) {
    return null;
  }

  return (
    <div
      className="h-full w-full"
      style={{
        display: isActive ? "block" : "none",
        // Prevent hidden views from affecting layout measurements
        visibility: isActive ? "visible" : "hidden",
      }}
      // Improve accessibility by hiding inactive views from screen readers
      aria-hidden={!isActive}
      // Prevent tab navigation into hidden views
      inert={!isActive || undefined}
    >
      {children}
    </div>
  );
}

/**
 * FileGatedContent - Renders both the main content and empty state,
 * showing/hiding based on file selection. Unlike conditional rendering,
 * this keeps both components mounted to preserve state.
 */
interface FileGatedContentProps {
  hasFile: boolean;
  children: ReactNode;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
}

function FileGatedContent({
  hasFile,
  children,
  emptyIcon: Icon,
  emptyTitle,
  emptyDescription,
}: FileGatedContentProps) {
  return (
    <>
      {/* Main content - always mounted, visibility controlled */}
      <div
        className="h-full w-full"
        style={{
          display: hasFile ? "block" : "none",
          visibility: hasFile ? "visible" : "hidden",
        }}
        aria-hidden={!hasFile}
        inert={!hasFile || undefined}
      >
        {children}
      </div>
      {/* Empty state - always mounted, visibility controlled */}
      <div
        className="h-full w-full flex items-center justify-center"
        style={{
          display: hasFile ? "none" : "flex",
          visibility: hasFile ? "hidden" : "visible",
        }}
        aria-hidden={hasFile}
        inert={hasFile || undefined}
      >
        <div className="text-center">
          <Icon className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">{emptyTitle}</h3>
          <p className="text-muted-foreground">{emptyDescription}</p>
        </div>
      </div>
    </>
  );
}

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
const BatchProcessingDashboard = lazy(() =>
  import("@/components/batch").then((mod) => ({
    default: mod.BatchProcessingDashboard,
  })),
);
const CompareView = lazy(() =>
  import("@/components/compare").then((mod) => ({
    default: mod.CompareView,
  })),
);
const PluginManagementPanel = lazy(() =>
  import("@/components/plugins").then((mod) => ({
    default: mod.PluginManagementPanel,
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
const CollaborationPanel = lazy(() =>
  import("@/components/collaboration").then((mod) => ({
    default: mod.CollaborationPanel,
  })),
);
const GalleryManagementPanel = lazy(() =>
  import("@/components/gallery").then((mod) => ({
    default: mod.GalleryManagementPanel,
  })),
);
const TutorialList = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.TutorialList,
  })),
);
const SampleDataManager = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.SampleDataManager,
  })),
);
const PaperReproductionBrowser = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.PaperReproductionBrowser,
  })),
);
const TutorialRunner = lazy(() =>
  import("@/components/learn").then((mod) => ({
    default: mod.TutorialRunner,
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

export function NavigationContent() {
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
          setPrimaryNav("analyze");
          setSecondaryNav("dda");
          break;
        case "view-timeseries":
          setPrimaryNav("explore");
          setSecondaryNav("timeseries");
          break;
        case "view-annotations":
          setPrimaryNav("explore");
          setSecondaryNav("annotations");
          break;
        case "view-file":
          setPrimaryNav("explore");
          setSecondaryNav("timeseries");
          break;
        case "view-settings":
          setPrimaryNav("settings");
          break;
        case "view-ica":
          setPrimaryNav("analyze");
          setSecondaryNav("ica");
          break;
        case "view-batch":
          setPrimaryNav("analyze");
          setSecondaryNav("batch");
          break;
        default:
          console.warn("[NAV] Unknown notification action type:", actionType);
      }
    },
    [setPrimaryNav, setSecondaryNav],
  );

  // Render all views but show/hide based on navigation state.
  // This keeps components mounted so they preserve their internal state
  // (chart instances, scroll positions, refs, etc.) across tab switches.
  return (
    <div className="flex-1 min-h-0 w-full relative">
      {/* Overview */}
      <MountedView isActive={primaryNav === "overview"}>
        <div className="p-6 h-full">
          <OverviewDashboard />
        </div>
      </MountedView>

      {/* Explore - Time Series */}
      <MountedView
        isActive={primaryNav === "explore" && secondaryNav === "timeseries"}
      >
        <div className="p-4 h-full">
          <FileGatedContent
            hasFile={hasSelectedFile}
            emptyIcon={Activity}
            emptyTitle="No File Selected"
            emptyDescription="Select a file from the sidebar to view time series data"
          >
            <div className="h-full flex flex-col gap-3">
              <BIDSContextIndicator variant="full" />
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ErrorBoundary>
                  <Suspense fallback={<DelayedLoadingFallback />}>
                    <TimeSeriesPlotECharts />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </div>
          </FileGatedContent>
        </div>
      </MountedView>

      {/* Explore - Annotations */}
      <MountedView
        isActive={primaryNav === "explore" && secondaryNav === "annotations"}
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <AnnotationsTab />
          </Suspense>
        </div>
      </MountedView>

      {/* Explore - Streaming */}
      <MountedView
        isActive={primaryNav === "explore" && secondaryNav === "streaming"}
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <StreamingView />
          </Suspense>
        </div>
      </MountedView>

      {/* Analyze - DDA */}
      <MountedView
        isActive={
          primaryNav === "analyze" && (secondaryNav === "dda" || !secondaryNav)
        }
      >
        <FileGatedContent
          hasFile={hasSelectedFile}
          emptyIcon={Brain}
          emptyTitle="No File Selected"
          emptyDescription="Select a file from the sidebar to run DDA analysis"
        >
          <div className="h-full flex flex-col">
            <div className="px-4 pt-4 pb-2">
              <BIDSContextIndicator variant="breadcrumb" />
            </div>
            <div className="flex-1 min-h-0">
              <Suspense fallback={<DelayedLoadingFallback />}>
                <DDAWithHistory />
              </Suspense>
            </div>
          </div>
        </FileGatedContent>
      </MountedView>

      {/* Analyze - ICA */}
      <MountedView
        isActive={primaryNav === "analyze" && secondaryNav === "ica"}
      >
        <FileGatedContent
          hasFile={hasSelectedFile}
          emptyIcon={Sparkles}
          emptyTitle="No File Selected"
          emptyDescription="Select a file from the sidebar to run ICA analysis"
        >
          <div className="h-full flex flex-col">
            <div className="px-4 pt-4 pb-2">
              <BIDSContextIndicator variant="breadcrumb" />
            </div>
            <div className="flex-1 min-h-0">
              <Suspense fallback={<DelayedLoadingFallback />}>
                <ICAAnalysisPanel />
              </Suspense>
            </div>
          </div>
        </FileGatedContent>
      </MountedView>

      {/* Analyze - Batch */}
      <MountedView
        isActive={primaryNav === "analyze" && secondaryNav === "batch"}
      >
        <div className="h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <BatchProcessingDashboard />
          </Suspense>
        </div>
      </MountedView>

      {/* Analyze - Compare */}
      <MountedView
        isActive={primaryNav === "analyze" && secondaryNav === "compare"}
      >
        <div className="h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <CompareView />
          </Suspense>
        </div>
      </MountedView>

      {/* Plugins (top-level) */}
      <MountedView isActive={primaryNav === "plugins"}>
        <div className="h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <PluginManagementPanel />
          </Suspense>
        </div>
      </MountedView>

      {/* Data - OpenNeuro */}
      <MountedView
        isActive={
          primaryNav === "data" &&
          (secondaryNav === "openneuro" || !secondaryNav)
        }
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <OpenNeuroBrowser />
          </Suspense>
        </div>
      </MountedView>

      {/* Data - NSG Jobs */}
      <MountedView
        isActive={primaryNav === "data" && secondaryNav === "nsg-jobs"}
      >
        <div className="p-4 h-full">
          <ErrorBoundary>
            <Suspense fallback={<DelayedLoadingFallback />}>
              <NSGJobManager />
            </Suspense>
          </ErrorBoundary>
        </div>
      </MountedView>

      {/* Collaborate - Gallery */}
      <MountedView
        isActive={primaryNav === "collaborate" && secondaryNav === "gallery"}
      >
        <div className="h-full">
          <ErrorBoundary>
            <Suspense fallback={<DelayedLoadingFallback />}>
              <GalleryManagementPanel />
            </Suspense>
          </ErrorBoundary>
        </div>
      </MountedView>

      {/* Learn - Tutorials (default) */}
      <MountedView
        isActive={
          primaryNav === "learn" &&
          (secondaryNav === "tutorials" || !secondaryNav)
        }
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <TutorialList />
          </Suspense>
        </div>
      </MountedView>

      {/* Learn - Sample Data */}
      <MountedView
        isActive={primaryNav === "learn" && secondaryNav === "sample-data"}
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <SampleDataManager />
          </Suspense>
        </div>
      </MountedView>

      {/* Learn - Papers */}
      <MountedView
        isActive={primaryNav === "learn" && secondaryNav === "papers"}
      >
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <PaperReproductionBrowser />
          </Suspense>
        </div>
      </MountedView>

      {/* Settings */}
      <MountedView isActive={primaryNav === "settings"}>
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <SettingsPanel />
          </Suspense>
        </div>
      </MountedView>

      {/* Notifications */}
      <MountedView isActive={primaryNav === "notifications"}>
        <div className="p-4 h-full">
          <Suspense fallback={<DelayedLoadingFallback />}>
            <NotificationHistory onNavigate={handleNotificationNavigate} />
          </Suspense>
        </div>
      </MountedView>

      {/* Tutorial Runner — rendered outside MountedViews so it persists across tab navigation */}
      <Suspense fallback={null}>
        <TutorialRunnerGate />
      </Suspense>
    </div>
  );
}

/** Only mounts TutorialRunner when a tutorial is active, to avoid loading the chunk otherwise. */
function TutorialRunnerGate() {
  const activeTutorialId = useAppStore((state) => state.learn.activeTutorialId);
  if (!activeTutorialId) return null;
  return <TutorialRunner />;
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

      <div>
        <h3 className="text-lg font-semibold mb-3">Get Started</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleQuickAction("learn", "tutorials")}
          >
            <CardContent className="p-6">
              <GraduationCap className="h-8 w-8 mb-3 text-primary" />
              <h3 className="font-semibold mb-1">Start Tutorial</h3>
              <p className="text-sm text-muted-foreground">
                Interactive guide to DDALAB
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleQuickAction("learn", "sample-data")}
          >
            <CardContent className="p-6">
              <Download className="h-8 w-8 mb-3 text-primary" />
              <h3 className="font-semibold mb-1">Sample Data</h3>
              <p className="text-sm text-muted-foreground">
                Download example EEG datasets
              </p>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => handleQuickAction("learn", "papers")}
          >
            <CardContent className="p-6">
              <FileSearch className="h-8 w-8 mb-3 text-primary" />
              <h3 className="font-semibold mb-1">Reproduce a Paper</h3>
              <p className="text-sm text-muted-foreground">
                Run analyses from published research
              </p>
            </CardContent>
          </Card>
        </div>
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
