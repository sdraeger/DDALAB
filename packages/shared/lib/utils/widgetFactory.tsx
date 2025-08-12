import React from "react";
import { FileBrowserWidget } from "../../components/dashboard/widgets/FileBrowserWidget";
import { DDAWidget } from "../../components/dashboard/widgets/DDAWidget";
import { ChartWidget } from "../../components/dashboard/widgets/ChartWidget";
import { DDAHeatmapWidget } from "../../components/dashboard/widgets/DDAHeatmapWidget";
import { DDALinePlotWidget } from "../../components/dashboard/widgets/DDALinePlotWidget";
import { Settings } from "lucide-react";

// Accept onFileSelect, widgetId, and isPopout as optional props
export function createWidgetContent(
  type?: string,
  widgetId?: string,
  isPopout?: boolean,
  onFileSelect?: (filePath: string) => void
): React.ReactNode {
  switch (type) {
    case "file-browser":
      return <FileBrowserWidget onFileSelect={onFileSelect} maxHeight="100%" />;

    case "dda-form":
      return <DDAWidget widgetId={widgetId} isPopout={isPopout} />;

    case "chart":
      return <ChartWidget widgetId={widgetId} isPopout={isPopout} />;

    case "dda-heatmap":
      return <DDAHeatmapWidget widgetId={widgetId} isPopout={isPopout} />;

    case "dda-line-plot":
      return <DDALinePlotWidget widgetId={widgetId} isPopout={isPopout} />;

    case "custom":
    default:
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <Settings className="h-8 w-8 mx-auto mb-2" />
            <p>Custom widget content</p>
          </div>
        </div>
      );
  }
}
