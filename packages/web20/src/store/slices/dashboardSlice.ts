import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  DashboardState,
  Widget,
  DashboardLayout,
  DashboardSettings,
  DragState,
  ResizeState,
} from "@/types/dashboard";

const initialState: DashboardState = {
  layouts: [],
  currentLayoutId: null,
  widgets: [],
  isDragging: false,
  isResizing: false,
  selectedWidgetId: null,
  dragState: null,
  resizeState: null,
  gridSize: 10,
  enableSnapping: true,
  enableCollisionDetection: true,
};

const dashboardSlice = createSlice({
  name: "dashboard",
  initialState,
  reducers: {
    // Layout management
    setCurrentLayout: (state, action: PayloadAction<string | null>) => {
      state.currentLayoutId = action.payload;
    },

    addLayout: (state, action: PayloadAction<DashboardLayout>) => {
      state.layouts.push(action.payload);
    },

    updateLayout: (
      state,
      action: PayloadAction<{ id: string; layout: Partial<DashboardLayout> }>
    ) => {
      const index = state.layouts.findIndex(
        (layout) => layout.id === action.payload.id
      );
      if (index !== -1) {
        state.layouts[index] = {
          ...state.layouts[index],
          ...action.payload.layout,
        };
      }
    },

    removeLayout: (state, action: PayloadAction<string>) => {
      state.layouts = state.layouts.filter(
        (layout) => layout.id !== action.payload
      );
      if (state.currentLayoutId === action.payload) {
        state.currentLayoutId = null;
      }
    },

    // Widget management
    addWidget: (state, action: PayloadAction<Widget>) => {
      state.widgets.push(action.payload);
    },

    updateWidget: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<Widget> }>
    ) => {
      const index = state.widgets.findIndex(
        (widget) => widget.id === action.payload.id
      );
      if (index !== -1) {
        state.widgets[index] = {
          ...state.widgets[index],
          ...action.payload.updates,
        };
      }
    },

    removeWidget: (state, action: PayloadAction<string>) => {
      state.widgets = state.widgets.filter(
        (widget) => widget.id !== action.payload
      );
      if (state.selectedWidgetId === action.payload) {
        state.selectedWidgetId = null;
      }
    },

    moveWidget: (
      state,
      action: PayloadAction<{ id: string; position: { x: number; y: number } }>
    ) => {
      const widget = state.widgets.find((w) => w.id === action.payload.id);
      if (widget) {
        widget.position = action.payload.position;
      }
    },

    resizeWidget: (
      state,
      action: PayloadAction<{
        id: string;
        size: { width: number; height: number };
      }>
    ) => {
      const widget = state.widgets.find((w) => w.id === action.payload.id);
      if (widget) {
        widget.size = action.payload.size;
      }
    },

    // Selection and interaction
    setSelectedWidget: (state, action: PayloadAction<string | null>) => {
      state.selectedWidgetId = action.payload;
    },

    setIsDragging: (state, action: PayloadAction<boolean>) => {
      state.isDragging = action.payload;
    },

    setIsResizing: (state, action: PayloadAction<boolean>) => {
      state.isResizing = action.payload;
    },

    // Drag and resize state management
    setDragState: (state, action: PayloadAction<DragState | null>) => {
      state.dragState = action.payload;
    },

    setResizeState: (state, action: PayloadAction<ResizeState | null>) => {
      state.resizeState = action.payload;
    },

    // Settings
    updateSettings: (
      state,
      action: PayloadAction<Partial<DashboardSettings>>
    ) => {
      Object.assign(state, action.payload);
    },

    // Batch operations
    setWidgets: (state, action: PayloadAction<Widget[]>) => {
      state.widgets = action.payload;
    },

    setLayouts: (state, action: PayloadAction<DashboardLayout[]>) => {
      state.layouts = action.payload;
    },

    // Widget state management
    minimizeWidget: (state, action: PayloadAction<string>) => {
      const widget = state.widgets.find((w) => w.id === action.payload);
      if (widget) {
        widget.isMinimized = true;
        widget.isMaximized = false;
      }
    },

    maximizeWidget: (state, action: PayloadAction<string>) => {
      const widget = state.widgets.find((w) => w.id === action.payload);
      if (widget) {
        widget.isMaximized = true;
        widget.isMinimized = false;
      }
    },

    restoreWidget: (state, action: PayloadAction<string>) => {
      const widget = state.widgets.find((w) => w.id === action.payload);
      if (widget) {
        widget.isMinimized = false;
        widget.isMaximized = false;
      }
    },

    popOutWidget: (state, action: PayloadAction<string>) => {
      const widget = state.widgets.find((w) => w.id === action.payload);
      if (widget && !widget.isPopOut) {
        // Store current position and size for restoration
        widget.previousPosition = { ...widget.position };
        widget.previousSize = { ...widget.size };
        widget.isPopOut = true;
        // Reset minimized/maximized states for pop-out
        widget.isMinimized = false;
        widget.isMaximized = false;
      }
    },

    popInWidget: (state, action: PayloadAction<string>) => {
      const widget = state.widgets.find((w) => w.id === action.payload);
      if (widget && widget.isPopOut) {
        widget.isPopOut = false;
        // Restore previous position and size if available
        if (widget.previousPosition) {
          widget.position = { ...widget.previousPosition };
        }
        if (widget.previousSize) {
          widget.size = { ...widget.previousSize };
        }
        // Clear the stored values
        widget.previousPosition = undefined;
        widget.previousSize = undefined;
      }
    },

  },
});

export const {
  setCurrentLayout,
  addLayout,
  updateLayout,
  removeLayout,
  addWidget,
  updateWidget,
  removeWidget,
  moveWidget,
  resizeWidget,
  setSelectedWidget,
  setIsDragging,
  setIsResizing,
  setDragState,
  setResizeState,
  updateSettings,
  setWidgets,
  setLayouts,
  minimizeWidget,
  maximizeWidget,
  restoreWidget,
  popOutWidget,
  popInWidget,
} = dashboardSlice.actions;

export default dashboardSlice.reducer;
