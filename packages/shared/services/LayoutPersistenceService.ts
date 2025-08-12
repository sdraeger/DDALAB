import type { Layout } from "react-grid-layout";
import { IDashboardWidget, ILayoutPersistence } from "../types/dashboard";
import logger from "../lib/utils/logger";
import { get, post, _delete } from "../lib/utils/request";
import {
  dashboardStorage,
  widgetLayoutStorage,
} from "../lib/utils/authModeStorage";

// Serializable widget data for persistence
interface SerializableWidgetData {
  id: string;
  title: string;
  type: string;
  metadata?: Record<string, any>;
  constraints?: any;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize?: { width?: number; height?: number };
  maxSize?: { width?: number; height?: number };
  isPopOut?: boolean;
}

// Layout Persistence Service (Single Responsibility Principle)
export class LayoutPersistenceService implements ILayoutPersistence {
  private static instance: LayoutPersistenceService;
  private accessToken: string | null = null;
  private isLocalMode: boolean = false; // Add local mode flag

  private constructor() {}

  public static getInstance(): LayoutPersistenceService {
    if (!LayoutPersistenceService.instance) {
      LayoutPersistenceService.instance = new LayoutPersistenceService();
    }
    return LayoutPersistenceService.instance;
  }

  /**
   * Set the access token for multi-user mode.
   */
  public setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /**
   * Set local mode flag. Should be called by the dashboard context/provider.
   */
  public setLocalMode(isLocal: boolean): void {
    this.isLocalMode = isLocal;
  }

  /**
   * Save layout and widgets. Uses localStorage in local mode, network in multi-user mode.
   */
  public async saveLayout(
    layout: Layout[],
    widgets: IDashboardWidget[]
  ): Promise<void> {
    if (this.isLocalMode) {
      // LOCAL MODE: Save to localStorage only
      dashboardStorage.setItem("layouts", layout);
      widgetLayoutStorage.setItem("widgets", widgets);
      logger.info(
        "[LocalMode] Saved dashboard layout and widgets to localStorage"
      );
      return;
    }
    // MULTI-USER MODE: Network request
    if (!this.accessToken) {
      throw new Error("No authentication token available");
    }

    try {
      logger.info("Saving modern dashboard layout with enhanced widget data");

      // Create a map for efficient layout lookups
      const layoutMap = new Map(layout.map((item) => [item.i, item]));

      // Serialize widgets with embedded layout information
      const serializableWidgets: SerializableWidgetData[] = widgets.map(
        (widget) => {
          const layoutItem = layoutMap.get(widget.id);

          return {
            id: widget.id,
            title: widget.title,
            type: widget.type,
            metadata: widget.metadata,
            constraints: widget.constraints,
            position: { x: layoutItem?.x || 0, y: layoutItem?.y || 0 },
            size: {
              width: layoutItem?.w || 0,
              height: layoutItem?.h || 0,
            },
            minSize:
              layoutItem?.minW || layoutItem?.minH
                ? {
                    width: layoutItem?.minW,
                    height: layoutItem?.minH,
                  }
                : undefined,
            maxSize:
              layoutItem?.maxW || layoutItem?.maxH
                ? {
                    width: layoutItem?.maxW,
                    height: layoutItem?.maxH,
                  }
                : undefined,
            isPopOut: widget.isPopOut || false,
          };
        }
      );

      const payload = {
        layout,
        widgets: serializableWidgets,
        version: "2.1", // Updated version to reflect enhanced save format
        timestamp: Date.now(),
      };

      // Log detailed information about what's being saved
      logger.info("Saving modern dashboard layout:", {
        layoutCount: layout.length,
        widgetCount: widgets.length,
        layoutSizes: layout.map((item) => ({
          id: item.i,
          w: item.w,
          h: item.h,
          x: item.x,
          y: item.y,
        })),
        version: payload.version,
      });

      await post("/api/widget-layouts", payload, this.accessToken);

      logger.info(
        "Modern dashboard layout saved successfully with widget sizes"
      );
    } catch (error) {
      logger.error("Error saving modern dashboard layout:", error);

      // Fallback to local storage if API fails
      logger.warn("Falling back to local storage due to API error");
      try {
        dashboardStorage.setItem("layouts", layout);
        widgetLayoutStorage.setItem("widgets", widgets);
        logger.info("Successfully saved to local storage as fallback");
      } catch (localError) {
        logger.error("Failed to save to local storage fallback:", localError);
        throw error; // Throw original error
      }

      throw error;
    }
  }

  /**
   * Load layout and widgets. Uses localStorage in local mode, network in multi-user mode.
   */
  public async loadLayout(): Promise<{
    layout: Layout[];
    widgets: IDashboardWidget[];
  } | null> {
    if (this.isLocalMode) {
      // LOCAL MODE: Load from localStorage only
      const layout = dashboardStorage.getItem<Layout[]>("layouts") || [];
      const widgets =
        widgetLayoutStorage.getItem<IDashboardWidget[]>("widgets") || [];
      logger.info(
        "[LocalMode] Loaded dashboard layout and widgets from localStorage"
      );
      return { layout, widgets };
    }
    // MULTI-USER MODE: Network request
    if (!this.accessToken) {
      logger.warn("No authentication token available for loading layout");
      return null;
    }

    try {
      // First try to load from server
      const response = await fetch(`/api/widget-layouts`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      logger.info(
        `[LayoutPersistenceService] Raw API response. Status: ${response.status}, OK: ${response.ok}, StatusText: ${response.statusText}`
      );

      if (!response.ok) {
        // Attempt to parse error details if response is not ok
        let errorDetails = response.statusText;
        try {
          const errorData = await response.json();
          errorDetails = JSON.stringify(errorData);
        } catch (jsonError) {
          logger.warn(`Failed to parse error JSON: ${jsonError}`);
        }

        logger.error("API request failed during layout load:", {
          status: response.status,
          statusText: response.statusText,
          errorDetails,
        });

        // For unauthorized or forbidden responses, return null to allow fallback to empty layout
        if (response.status === 401 || response.status === 403) {
          logger.warn("Unauthorized access to layout - using empty layout");
          return null;
        }

        throw new Error(
          `Failed to load layout: ${errorDetails || "Unknown error"}`
        );
      }

      const data = await response.json();

      // Validate the response structure
      if (!data.layout || !data.widgets) {
        logger.warn("Invalid layout data structure received");
        return null;
      }

      // Log detailed information about what's being loaded
      logger.info("Loading modern dashboard layout:", {
        layoutCount: data.layout.length,
        widgetCount: data.widgets.length,
        layoutSizes: data.layout.map((item: Layout) => ({
          id: item.i,
          w: item.w,
          h: item.h,
          x: item.x,
          y: item.y,
        })),
        version: data.version || "unknown",
      });

      // Validate that layout items have size information
      const layoutItems = data.layout as Layout[];
      const missingSize = layoutItems.filter(
        (item) => typeof item.w === "undefined" || typeof item.h === "undefined"
      );

      if (missingSize.length > 0) {
        logger.warn(
          "Some layout items are missing size information:",
          missingSize
        );
      }

      logger.info(
        `Loaded modern dashboard layout with ${data.widgets.length} widgets and preserved sizes`
      );

      // Return layout and serializable widget data
      // The widgets will be recreated by the WidgetFactory
      return {
        layout: data.layout,
        widgets: data.widgets, // These are SerializableWidgetData, will be converted to full widgets
      };
    } catch (error) {
      logger.error("Error loading modern dashboard layout:", error);
      throw error;
    }
  }

  /**
   * Clear layout and widgets. Uses localStorage in local mode, network in multi-user mode.
   */
  public async clearLayout(): Promise<void> {
    if (this.isLocalMode) {
      // LOCAL MODE: Clear from localStorage only
      dashboardStorage.clear();
      widgetLayoutStorage.clear();
      logger.info(
        "[LocalMode] Cleared dashboard layout and widgets from localStorage"
      );
      return;
    }
    // MULTI-USER MODE: Network request
    if (!this.accessToken) {
      throw new Error("No authentication token available");
    }

    try {
      await _delete("/api/widget-layouts", this.accessToken);

      logger.info("Modern dashboard layout cleared successfully");
    } catch (error) {
      logger.error("Error clearing modern dashboard layout:", error);
      throw error;
    }
  }

  /**
   * Check if layout exists. Uses localStorage in local mode, network in multi-user mode.
   */
  public async hasLayout(): Promise<boolean> {
    if (this.isLocalMode) {
      // LOCAL MODE: Check localStorage only
      const layout = dashboardStorage.getItem<Layout[]>("layouts");
      const widgets =
        widgetLayoutStorage.getItem<IDashboardWidget[]>("widgets");
      return (
        !!(layout && layout.length > 0) || !!(widgets && widgets.length > 0)
      );
    }
    // MULTI-USER MODE: Network request
    if (!this.accessToken) {
      return false;
    }

    try {
      // The `get` function currently returns the response body directly,
      // so we need a different approach for a HEAD request.
      // For now, we'll mimic the old `apiRequest` behavior by performing a GET and checking status.
      const response = await fetch(`/api/widget-layouts`, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      return response.ok;
    } catch (error) {
      logger.error("Error checking for existing layout:", error);
      return false;
    }
  }
}
