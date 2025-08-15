export interface Widget {
  id: string;
  title: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  isPopOut?: boolean;
  isMinimized?: boolean;
  isMaximized?: boolean;
  data?: any;
  settings?: Record<string, any>;
  // Position and size before popping out (for restoration)
  previousPosition?: { x: number; y: number };
  previousSize?: { width: number; height: number };
}

export interface DashboardLayout {
  id: string;
  name: string;
  widgets: Widget[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardState {
  layouts: DashboardLayout[];
  currentLayoutId: string | null;
  widgets: Widget[];
  isDragging: boolean;
  isResizing: boolean;
  selectedWidgetId: string | null;
  dragState: DragState | null;
  resizeState: ResizeState | null;
  gridSize: number;
  enableSnapping: boolean;
  enableCollisionDetection: boolean;
}

export interface WidgetType {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  maxSize: { width: number; height: number };
  component: React.ComponentType<any>;
}

export interface DragState {
  widgetId: string;
  startPosition: { x: number; y: number };
  currentPosition: { x: number; y: number };
  mouseStart: { x: number; y: number };
}

export interface ResizeState {
  widgetId: string;
  startSize: { width: number; height: number };
  currentSize: { width: number; height: number };
  resizeHandle: string;
  mouseStart: { x: number; y: number };
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DashboardSettings {
  gridSize: number;
  enableSnapping: boolean;
  enableCollisionDetection: boolean;
  enableAnimations: boolean;
  theme: "light" | "dark" | "system";
}

export interface UserPreferences {
  dashboardSettings: DashboardSettings;
  sidebarCollapsed: boolean;
  headerVisible: boolean;
  footerVisible: boolean;
}

export interface DashboardStats {
  totalArtifacts: number;
  totalAnalyses: number;
  activeUsers: number;
  systemHealth: "excellent" | "good" | "fair" | "poor";
}
