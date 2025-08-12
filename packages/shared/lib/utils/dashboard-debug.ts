import type { Layout } from "react-grid-layout";
import type { IDashboardWidget } from "../../types/dashboard";
import { apiRequest } from "./request";

// Debugging utility for modern dashboard layout persistence
export class DashboardDebugger {
  private static instance: DashboardDebugger;

  private constructor() {}

  public static getInstance(): DashboardDebugger {
    if (!DashboardDebugger.instance) {
      DashboardDebugger.instance = new DashboardDebugger();
    }
    return DashboardDebugger.instance;
  }

  // Analyze layout and widget data for debugging
  public analyzeLayout(layout: Layout[], widgets: IDashboardWidget[]): void {
    console.group("🔍 Dashboard Layout Analysis");

    // Basic stats
    console.log("Layout Overview:", {
      totalLayouts: layout.length,
      totalWidgets: widgets.length,
      layoutIds: layout.map((l) => l.i),
      widgetIds: widgets.map((w) => w.id),
    });

    // Widget analysis
    console.group("🧩 Widget Analysis");
    widgets.forEach((widget, index) => {
      const layoutItem = layout.find((l) => l.i === widget.id);
      console.log(`Widget ${index + 1}:`, {
        id: widget.id,
        type: widget.type,
        title: widget.title,
        hasLayout: !!layoutItem,
        constraints: widget.constraints,
        layoutInfo: layoutItem
          ? {
              size: `${layoutItem.w}x${layoutItem.h}`,
              position: `(${layoutItem.x},${layoutItem.y})`,
              constraints: {
                minW: layoutItem.minW,
                maxW: layoutItem.maxW,
                minH: layoutItem.minH,
                maxH: layoutItem.maxH,
              },
              properties: {
                isDraggable: layoutItem.isDraggable,
                isResizable: layoutItem.isResizable,
                static: layoutItem.static,
              },
            }
          : null,
      });
    });
    console.groupEnd();

    // Layout item analysis
    console.group("📐 Layout Items Analysis");
    layout.forEach((item, index) => {
      const widget = widgets.find((w) => w.id === item.i);
      console.log(`Layout Item ${index + 1}:`, {
        id: item.i,
        hasWidget: !!widget,
        widgetType: widget?.type || "unknown",
        size: `${item.w}x${item.h}`,
        position: `(${item.x},${item.y})`,
        constraints: {
          minW: item.minW,
          maxW: item.maxW,
          minH: item.minH,
          maxH: item.maxH,
        },
        properties: {
          isDraggable: item.isDraggable,
          isResizable: item.isResizable,
          static: item.static,
        },
      });
    });
    console.groupEnd();

    // Validation
    console.group("✅ Validation");
    const orphanedWidgets = widgets.filter(
      (w) => !layout.some((l) => l.i === w.id)
    );
    const orphanedLayout = layout.filter(
      (l) => !widgets.some((w) => w.id === l.i)
    );

    console.log(
      "Orphaned widgets (no layout):",
      orphanedWidgets.map((w) => ({ id: w.id, type: w.type }))
    );
    console.log(
      "Orphaned layout items (no widget):",
      orphanedLayout.map((l) => ({ id: l.i, size: `${l.w}x${l.h}` }))
    );

    const hasSizeIssues = layout.some(
      (item) =>
        typeof item.w === "undefined" ||
        typeof item.h === "undefined" ||
        item.w <= 0 ||
        item.h <= 0
    );

    console.log("Has size issues:", hasSizeIssues);
    if (hasSizeIssues) {
      const problematicItems = layout.filter(
        (item) =>
          typeof item.w === "undefined" ||
          typeof item.h === "undefined" ||
          item.w <= 0 ||
          item.h <= 0
      );
      console.log("Problematic items:", problematicItems);
    }

    console.groupEnd();
    console.groupEnd();
  }

  // Compare saved vs loaded data
  public compareLayoutData(
    savedData: { layout: Layout[]; widgets: any[] },
    loadedData: { layout: Layout[]; widgets: any[] }
  ): void {
    console.group("🔄 Layout Data Comparison");

    console.log("Saved Data:", {
      layoutCount: savedData.layout.length,
      widgetCount: savedData.widgets.length,
      layoutSizes: savedData.layout.map((item) => ({
        id: item.i,
        size: `${item.w}x${item.h}`,
      })),
    });

    console.log("Loaded Data:", {
      layoutCount: loadedData.layout.length,
      widgetCount: loadedData.widgets.length,
      layoutSizes: loadedData.layout.map((item) => ({
        id: item.i,
        size: `${item.w}x${item.h}`,
      })),
    });

    // Check for differences
    const sizeDifferences = [];
    for (const savedItem of savedData.layout) {
      const loadedItem = loadedData.layout.find(
        (item) => item.i === savedItem.i
      );
      if (loadedItem) {
        if (savedItem.w !== loadedItem.w || savedItem.h !== loadedItem.h) {
          sizeDifferences.push({
            id: savedItem.i,
            saved: `${savedItem.w}x${savedItem.h}`,
            loaded: `${loadedItem.w}x${loadedItem.h}`,
          });
        }
      }
    }

    if (sizeDifferences.length > 0) {
      console.warn("⚠️ Size differences detected:", sizeDifferences);
    } else {
      console.log("✅ All widget sizes match between saved and loaded data");
    }

    console.groupEnd();
  }

  // Helper to inspect current mock storage (for development)
  public async inspectMockStorage(userId: string): Promise<void> {
    try {
      const response = await apiRequest({
        url: "/api/widget-layouts",
        method: "GET",
        responseType: "response",
      });

      if (response.ok) {
        const data = await response.json();
        console.group("💾 Mock Storage Inspection");
        console.log("Stored data:", data);
        console.log(
          "Layout items:",
          data.layout?.map((item: Layout) => ({
            id: item.i,
            size: `${item.w}x${item.h}`,
            position: `(${item.x},${item.y})`,
          }))
        );
        console.groupEnd();
      } else {
        console.log("No stored layout data found");
      }
    } catch (error) {
      console.error("Error inspecting mock storage:", error);
    }
  }
}

// Export singleton instance
export const dashboardDebugger = DashboardDebugger.getInstance();

// Global debug functions for browser console
declare global {
  interface Window {
    debugDashboard?: {
      analyzeLayout: (layout: Layout[], widgets: IDashboardWidget[]) => void;
      compareLayoutData: (saved: any, loaded: any) => void;
      inspectMockStorage: (userId: string) => Promise<void>;
    };
  }
}

// Make debugging functions available globally in development
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  window.debugDashboard = {
    analyzeLayout: dashboardDebugger.analyzeLayout.bind(dashboardDebugger),
    compareLayoutData:
      dashboardDebugger.compareLayoutData.bind(dashboardDebugger),
    inspectMockStorage:
      dashboardDebugger.inspectMockStorage.bind(dashboardDebugger),
  };
}
