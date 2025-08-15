import { useAppDispatch, useWidgets } from "@/store/hooks";
import { saveLayouts, fetchLayouts } from "@/store/slices/apiSlice";
import { Layout } from "@/types/layouts";
import { Widget } from "@/types/dashboard";
import { apiService } from "@/lib/api";
import logger from "@/lib/utils/logger";

export class LayoutPersistenceService {
  private static instance: LayoutPersistenceService;
  private dispatch: any;
  private isLocalMode: boolean = false;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private lastSavedLayout: string = "";

  private constructor() {}

  static getInstance(): LayoutPersistenceService {
    if (!LayoutPersistenceService.instance) {
      LayoutPersistenceService.instance = new LayoutPersistenceService();
    }
    return LayoutPersistenceService.instance;
  }

  setDispatch(dispatch: any) {
    this.dispatch = dispatch;
  }

  setAccessToken(token: string | null) {
    apiService.setToken(token);
  }

  setLocalMode(isLocal: boolean) {
    this.isLocalMode = isLocal;
  }

  // Convert widgets to API layout format
  private widgetsToLayouts(widgets: Widget[]): Layout[] {
    return widgets.map((widget) => ({
      i: widget.id,
      x: Math.round(widget.position.x / 10), // Convert to grid units
      y: Math.round(widget.position.y / 10),
      w: Math.round(widget.size.width / 10),
      h: Math.round(widget.size.height / 10),
    }));
  }

  // Convert API layout format to widgets
  private layoutsToWidgets(layouts: Layout[]): Partial<Widget>[] {
    return layouts.map((layout) => ({
      id: layout.i,
      position: { x: layout.x * 10, y: layout.y * 10 },
      size: { width: layout.w * 10, height: layout.h * 10 },
    }));
  }

  // Save current layout to API
  async saveCurrentLayout(widgets: Widget[]): Promise<void> {
    if (!this.dispatch) {
      console.error("Dispatch not set in LayoutPersistenceService");
      return;
    }

    try {
      const layouts = this.widgetsToLayouts(widgets);

      if (this.isLocalMode) {
        // Local mode - save to localStorage
        const cleanWidgets = this.cleanWidgetsForSerialization(widgets);
        localStorage.setItem("web20-layouts", JSON.stringify(layouts));
        localStorage.setItem("web20-widgets", JSON.stringify(cleanWidgets));
        logger.info("[LocalMode] Saved dashboard layout to localStorage");
        return;
      }

      // Multi-user mode - save to server
      // Token is managed by apiService, no need to check here

      // Serialize widgets for persistence
      const serializableWidgets = widgets.map((widget) => ({
        id: widget.id,
        title: widget.title,
        type: widget.type,
        position: widget.position,
        size: widget.size,
        minSize: widget.minSize,
        maxSize: widget.maxSize,
        isPopOut: widget.isPopOut || false,
        isMinimized: widget.isMinimized || false,
        isMaximized: widget.isMaximized || false,
        previousPosition: widget.previousPosition,
        previousSize: widget.previousSize,
        data: widget.data,
        settings: widget.settings || {},
      }));

      const response = await apiService.request<{
        status: string;
        message: string;
      }>("/api/widget-layouts", {
        method: "POST",
        body: JSON.stringify({ widgets: serializableWidgets }),
      });

      if (response.error) {
        throw new Error(`Failed to save layout: ${response.error}`);
      }

      // Update last saved reference
      this.lastSavedLayout = JSON.stringify(serializableWidgets);

      logger.info("Dashboard layout saved successfully to database");
    } catch (error) {
      logger.error("Failed to save layout:", error);
      throw error;
    }
  }

  // Load layout from API
  async loadLayout(): Promise<Widget[]> {
    if (!this.dispatch) {
      console.error("Dispatch not set in LayoutPersistenceService");
      return [];
    }

    try {
      if (this.isLocalMode) {
        // Local mode - load from localStorage
        const savedLayouts = localStorage.getItem("web20-layouts");
        const savedWidgets = localStorage.getItem("web20-widgets");

        if (savedWidgets) {
          const widgets = JSON.parse(savedWidgets);
          
          // Return loaded widgets as-is since we no longer store window references
          const cleanedWidgets = widgets;
          
          logger.info("[LocalMode] Loaded dashboard layout from localStorage");
          return cleanedWidgets;
        }
        return [];
      }

      // Multi-user mode - load from server
      // Token is managed by apiService, no need to check here

      const response = await apiService.request<{ widgets: Widget[] }>(
        "/api/widget-layouts"
      );

      if (response.error) {
        if (response.status === 404) {
          logger.info("No saved layout found - this is normal for new users");
          return [];
        }
        throw new Error(`Failed to load layout: ${response.error}`);
      }

      const loadedWidgets = response.data?.widgets || [];

      // Return loaded widgets as-is since we no longer store window references
      const cleanedWidgets = loadedWidgets;

      // Update last saved reference
      this.lastSavedLayout = JSON.stringify(this.cleanWidgetsForSerialization(cleanedWidgets));

      logger.info("Loaded dashboard layout from database");
      return cleanedWidgets;
    } catch (error) {
      logger.error("Failed to load layout:", error);
      return [];
    }
  }

  // Clean widgets for serialization by removing non-serializable properties
  private cleanWidgetsForSerialization(widgets: Widget[]): any[] {
    // No non-serializable properties to remove anymore
    return widgets;
  }

  // Auto-save functionality
  scheduleAutoSave(widgets: Widget[]): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    // Clean widgets for JSON serialization
    const cleanWidgets = this.cleanWidgetsForSerialization(widgets);
    
    // Check if layout has actually changed
    const currentLayoutString = JSON.stringify(cleanWidgets);
    if (currentLayoutString === this.lastSavedLayout) {
      return; // No changes to save
    }

    // Schedule save with 2 second delay
    this.autoSaveTimer = setTimeout(() => {
      this.saveCurrentLayout(widgets).catch((error) => {
        logger.error("Auto-save failed:", error);
      });
    }, 2000);
  }

  // Clear auto-save timer
  clearAutoSaveTimer(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // Delete layout
  async deleteLayout(): Promise<void> {
    if (this.isLocalMode) {
      localStorage.removeItem("web20-layouts");
      localStorage.removeItem("web20-widgets");
      this.lastSavedLayout = "";
      logger.info("[LocalMode] Cleared dashboard layout from localStorage");
      return;
    }

    // Token is managed by apiService, no need to check here

    try {
      const response = await apiService.request<{
        status: string;
        message: string;
      }>("/api/widget-layouts", {
        method: "DELETE",
      });

      if (response.error) {
        throw new Error(`Failed to delete layout: ${response.error}`);
      }

      this.lastSavedLayout = "";
      logger.info("Dashboard layout deleted successfully");
    } catch (error) {
      logger.error("Failed to delete layout:", error);
      throw error;
    }
  }
}

export const layoutPersistenceService = LayoutPersistenceService.getInstance();
