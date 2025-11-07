"use client";

import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";

// Import existing components
import { TimeSeriesPlotECharts } from "@/components/TimeSeriesPlotECharts";
import { AnnotationsTab } from "@/components/AnnotationsTab";
import { StreamingView } from "@/components/streaming";
import { DDAWithHistory } from "@/components/dda/DDAWithHistory";
import { SettingsPanel } from "@/components/SettingsPanel";
import { OpenNeuroBrowser } from "@/components/OpenNeuroBrowser";
import { NSGJobManager } from "@/components/NSGJobManager";
import { NotificationHistory } from "@/components/NotificationHistory";
import { FileInfoCard } from "@/components/FileInfoCard";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, Activity, FileText } from "lucide-react";

interface NavigationContentProps {
  apiService: ApiService;
}

export function NavigationContent({ apiService }: NavigationContentProps) {
  const primaryNav = useAppStore((state) => state.ui.primaryNav);
  const secondaryNav = useAppStore((state) => state.ui.secondaryNav);
  // Select ONLY a primitive boolean, not the entire selectedFile object
  // This prevents re-renders when the selectedFile object reference changes
  const hasSelectedFile = useAppStore(
    (state) => !!state.fileManager.selectedFile,
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
        <div className="p-4 h-full">
          {hasSelectedFile ? (
            <TimeSeriesPlotECharts apiService={apiService} />
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
          <AnnotationsTab />
        </div>
      );
    }

    if (secondaryNav === "streaming") {
      return (
        <div className="p-4 h-full">
          <StreamingView />
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

  // Analyze
  if (primaryNav === "analyze") {
    if (secondaryNav === "dda") {
      return (
        <div className="h-full">
          {hasSelectedFile ? (
            <DDAWithHistory apiService={apiService} />
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

    return (
      <ComingSoonPlaceholder
        feature={secondaryNav || "Feature"}
        category="Analysis Tools"
      />
    );
  }

  // Manage
  if (primaryNav === "manage") {
    if (secondaryNav === "settings") {
      return (
        <div className="p-4 h-full">
          <SettingsPanel />
        </div>
      );
    }

    if (secondaryNav === "data-sources") {
      return (
        <div className="p-4 h-full">
          <OpenNeuroBrowser />
        </div>
      );
    }

    if (secondaryNav === "jobs") {
      return (
        <div className="p-4 h-full">
          <NSGJobManager />
        </div>
      );
    }
  }

  // Notifications
  if (primaryNav === "notifications") {
    return (
      <div className="p-4 h-full">
        <NotificationHistory />
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

  const handleQuickAction = (primary: any, secondary: any) => {
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
  icon: any;
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
