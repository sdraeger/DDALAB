import { ReactNode } from "react";
import { Layout } from "react-grid-layout";

// Core Widget Interface
export interface IDashboardWidget {
  id: string;
  title: string;
  type: string;
  content: ReactNode;
  metadata?: Record<string, any>;
  constraints?: IWidgetConstraints;
  // Popout-related properties
  supportsPopout?: boolean;
  popoutPreferences?: IWidgetPopoutPreferences;
}

// Widget Popout Preferences
export interface IWidgetPopoutPreferences {
  defaultSize?: "normal" | "large" | "fullscreen";
  allowResize?: boolean;
  showKeyboardShortcuts?: boolean;
  optimizeForPopout?: boolean;
}

// Widget Constraints Interface
export interface IWidgetConstraints {
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  isResizable?: boolean;
  isDraggable?: boolean;
  static?: boolean;
}

// Layout Management Interface
export interface ILayoutManager {
  getLayout(): Layout[];
  updateLayout(layout: Layout[]): void;
  addWidget(widget: IDashboardWidget, position?: Partial<Layout>): void;
  removeWidget(widgetId: string): void;
  resetLayout(): void;
}

// Widget Factory Interface
export interface IWidgetFactory {
  createWidget(type: string, config?: any): IDashboardWidget;
  registerWidgetType(type: string, creator: WidgetCreator): void;
  getAvailableTypes(): string[];
}

// Widget Creator Function Type
export type WidgetCreator = (config?: any) => IDashboardWidget;

// Dashboard Configuration
export interface IDashboardConfig {
  cols: { [key: string]: number };
  breakpoints: { [key: string]: number };
  rowHeight: number;
  margin: [number, number];
  containerPadding: [number, number];
  enableDocking?: boolean;
  enablePersistence?: boolean;
  autoSave?: boolean;
  autoSaveDelay?: number;
  onBreakpointChange?: (breakpoint: string, cols: number) => void;
}

// Dockable Panel Configuration
export interface IDockConfig {
  position: "left" | "right" | "top" | "bottom";
  size: number;
  isVisible: boolean;
  fluid?: boolean;
  dimMode?: "none" | "transparent" | "opaque";
}

// Layout Persistence Interface
export interface ILayoutPersistence {
  saveLayout(layout: Layout[], widgets: IDashboardWidget[]): Promise<void>;
  loadLayout(): Promise<{
    layout: Layout[];
    widgets: IDashboardWidget[];
  } | null>;
  clearLayout(): Promise<void>;
}

// Dashboard Events
export interface IDashboardEvents {
  onLayoutChange?: (layout: Layout[]) => void;
  onWidgetAdd?: (widget: IDashboardWidget) => void;
  onWidgetRemove?: (widgetId: string) => void;
  onWidgetUpdate?: (
    widgetId: string,
    updates: Partial<IDashboardWidget>
  ) => void;
  onBreakpointChange?: (breakpoint: string, cols: number) => void;
}

// Responsive Layout State
export interface IResponsiveState {
  currentBreakpoint: string;
  currentCols: number;
  containerWidth: number;
}

// Modern Dashboard State
export interface IModernDashboardState {
  widgets: IDashboardWidget[];
  layout: Layout[];
  dockPanels: Map<string, IDockConfig>;
  responsive: IResponsiveState;
  isLoading: boolean;
  isSaving: boolean;
  saveStatus: "idle" | "saving" | "success" | "error";
}

export interface ModernDashboardGridProps {
  widgets: IDashboardWidget[];
  layout: Layout[];
  config: IDashboardConfig;
  onLayoutChange: (layout: Layout[]) => void;
  onWidgetRemove: (widgetId: string) => void;
  onWidgetUpdate: (
    widgetId: string,
    updates: Partial<IDashboardWidget>
  ) => void;
  onBreakpointChange: (breakpoint: string, cols: number) => void;
  className?: string;
  isLoading?: boolean;
  isSaving?: boolean;
  saveStatus?: "idle" | "saving" | "success" | "error";
}
