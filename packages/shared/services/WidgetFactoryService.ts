import React from "react";
import {
  IDashboardWidget,
  IWidgetFactory,
  WidgetCreator,
} from "../types/dashboard";
import { FileBrowserWidget } from "../components/dashboard/widgets/FileBrowserWidget";
import { DDAWidget } from "../components/dashboard/widgets/DDAWidget";
import { ChartWidget } from "../components/dashboard/widgets/ChartWidget";
import { DDAHeatmapWidget } from "../components/dashboard/widgets/DDAHeatmapWidget";
import { DDALinePlotWidget } from "../components/dashboard/widgets/DDALinePlotWidget";
import { Settings } from "lucide-react";

export class WidgetFactoryService implements IWidgetFactory {
  private static instance: WidgetFactoryService;
  private widgetCreators: Map<string, WidgetCreator> = new Map();

  private constructor() {
    this.registerDefaultWidgets();
  }

  public static getInstance(): WidgetFactoryService {
    if (!WidgetFactoryService.instance) {
      WidgetFactoryService.instance = new WidgetFactoryService();
    }
    return WidgetFactoryService.instance;
  }

  public createWidget(type: string, config?: any): IDashboardWidget {
    const creator = this.widgetCreators.get(type);
    if (!creator) {
      throw new Error(`Unknown widget type: ${type}`);
    }
    return creator(config);
  }

  public registerWidgetType(type: string, creator: WidgetCreator): void {
    this.widgetCreators.set(type, creator);
  }

  public getAvailableTypes(): string[] {
    return Array.from(this.widgetCreators.keys());
  }

  private registerDefaultWidgets(): void {
    // File Browser Widget
    this.registerWidgetType("file-browser", (config) => ({
      id: config?.id || `file-browser-${Date.now()}`,
      title: config?.title || "File Browser",
      type: "file-browser",
      content: React.createElement(FileBrowserWidget, {
        onFileSelect: config?.onFileSelect,
        maxHeight: config?.maxHeight || (config?.isPopout ? "100%" : "400px"),
        // Note: Additional popout props will be handled by cloneElement in WidgetPopoutDialog
      }),
      constraints: {
        minW: 3,
        maxW: 8,
        minH: 4,
        maxH: 10,
        isResizable: true,
        isDraggable: true,
      },
      metadata: config?.metadata || {},
      supportsPopout: true,
      popoutPreferences: {
        defaultSize: "large",
        allowResize: true,
        showKeyboardShortcuts: true,
        optimizeForPopout: true,
      },
    }));

    // DDA Analysis Form Widget
    this.registerWidgetType("dda-form", (config) => ({
      id: config?.id || `dda-form-${Date.now()}`,
      title: config?.title || "DDA Analysis Form",
      type: "dda-form",
      content: React.createElement(DDAWidget),
      constraints: {
        minW: 3,
        maxW: 8,
        minH: 4,
        maxH: 10,
        isResizable: true,
        isDraggable: true,
      },
      metadata: config?.metadata || {},
      supportsPopout: true,
      popoutPreferences: {
        defaultSize: "large",
        allowResize: true,
        showKeyboardShortcuts: true,
        optimizeForPopout: true,
      },
    }));

    // Chart Widget
    this.registerWidgetType("chart", (config) => ({
      id: config?.id || `chart-${Date.now()}`,
      title: config?.title || "Data Visualization",
      type: "chart",
      content: React.createElement(ChartWidget, {
        isPopout: config?.isPopout || false,
        popoutPlotState: config?.metadata?.plotState || config?.popoutPlotState,
      } as any),
      constraints: {
        minW: 4,
        maxW: 12,
        minH: 3,
        maxH: 8,
        isResizable: true,
        isDraggable: true,
      },
      metadata: config?.metadata || {},
      supportsPopout: true,
      popoutPreferences: {
        defaultSize: "fullscreen",
        allowResize: true,
        showKeyboardShortcuts: true,
        optimizeForPopout: true,
      },
    }));

    // DDA Heatmap Widget
    this.registerWidgetType("dda-heatmap", (config) => ({
      id: config?.id || `dda-heatmap-${Date.now()}`,
      title: config?.title || "DDA Heatmap",
      type: "dda-heatmap",
      content: React.createElement(DDAHeatmapWidget),
      constraints: {
        minW: 4,
        maxW: 12,
        minH: 4,
        maxH: 8,
        isResizable: true,
        isDraggable: true,
      },
      metadata: config?.metadata || {},
      supportsPopout: true,
      popoutPreferences: {
        defaultSize: "fullscreen",
        allowResize: true,
        showKeyboardShortcuts: true,
        optimizeForPopout: true,
      },
    }));

    // DDA Line Plot Widget
    this.registerWidgetType("dda-line-plot", (config) => ({
      id: config?.id || `dda-line-plot-${Date.now()}`,
      title: config?.title || "DDA Line Plot",
      type: "dda-line-plot",
      content: React.createElement(DDALinePlotWidget),
      constraints: {
        minW: 4,
        maxW: 12,
        minH: 4,
        maxH: 8,
        isResizable: true,
        isDraggable: true,
      },
      metadata: config?.metadata || {},
      supportsPopout: true,
      popoutPreferences: {
        defaultSize: "fullscreen",
        allowResize: true,
        showKeyboardShortcuts: true,
        optimizeForPopout: true,
      },
    }));

    // Custom Widget (fallback)
    this.registerWidgetType("custom", (config) => ({
      id: config?.id || `custom-${Date.now()}`,
      title: config?.title || "Custom Widget",
      type: "custom",
      content: React.createElement(
        "div",
        { className: "flex items-center justify-center h-full" },
        React.createElement(
          "div",
          { className: "text-center text-muted-foreground" },
          React.createElement(Settings, { className: "h-8 w-8 mx-auto mb-2" }),
          React.createElement(
            "p",
            null,
            config?.message || "Custom widget content"
          )
        )
      ),
      constraints: {
        minW: 2,
        maxW: 12,
        minH: 2,
        maxH: 12,
        isResizable: true,
        isDraggable: true,
      },
      metadata: config?.metadata || {},
      supportsPopout: true,
      popoutPreferences: {
        defaultSize: "normal",
        allowResize: true,
        showKeyboardShortcuts: false,
        optimizeForPopout: false,
      },
    }));
  }
}
