import { useDispatch, useSelector, TypedUseSelectorHook } from "react-redux";
import type { RootState, AppDispatch } from "./index";

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// Dashboard selectors
export const useDashboardState = () =>
  useAppSelector((state) => state.dashboard);
export const useWidgets = () =>
  useAppSelector((state) => state.dashboard.widgets);
export const useLayouts = () =>
  useAppSelector((state) => state.dashboard.layouts);
export const useCurrentLayoutId = () =>
  useAppSelector((state) => state.dashboard.currentLayoutId);
export const useSelectedWidgetId = () =>
  useAppSelector((state) => state.dashboard.selectedWidgetId);
export const useIsDragging = () =>
  useAppSelector((state) => state.dashboard.isDragging);
export const useIsResizing = () =>
  useAppSelector((state) => state.dashboard.isResizing);
export const useDragState = () =>
  useAppSelector((state) => state.dashboard.dragState);
export const useResizeState = () =>
  useAppSelector((state) => state.dashboard.resizeState);
export const useDashboardSettings = () =>
  useAppSelector((state) => ({
    gridSize: state.dashboard.gridSize,
    enableSnapping: state.dashboard.enableSnapping,
    enableCollisionDetection: state.dashboard.enableCollisionDetection,
  }));

// User selectors
export const useUserState = () => useAppSelector((state) => state.user);
export const useUser = () => useAppSelector((state) => state.user.user);
export const useIsAuthenticated = () =>
  useAppSelector((state) => state.user.isAuthenticated);
export const useUserPreferences = () =>
  useAppSelector((state) => state.user.preferences);
export const useSidebarCollapsed = () =>
  useAppSelector((state) => state.user.sidebarCollapsed);
export const useHeaderVisible = () =>
  useAppSelector((state) => state.user.headerVisible);
export const useFooterVisible = () =>
  useAppSelector((state) => state.user.footerVisible);
export const useTheme = () => useAppSelector((state) => state.user.theme);

// Auth selectors
export const useAuthState = () => useAppSelector((state) => state.auth);
export const useAuthUser = () => useAppSelector((state) => state.auth.user);
export const useAuthToken = () => useAppSelector((state) => state.auth.token);
export const useIsAuthAuthenticated = () =>
  useAppSelector((state) => state.auth.isAuthenticated);
export const useAuthMode = () => useAppSelector((state) => state.auth.authMode);
export const useAuthLoading = () =>
  useAppSelector((state) => state.auth.isLoading);
export const useAuthError = () => useAppSelector((state) => state.auth.error);

// API selectors
export const useApiState = () => useAppSelector((state) => state.api);
export const useDashboardStats = () =>
  useAppSelector((state) => state.api.dashboardStats);
export const useApiLayouts = () => useAppSelector((state) => state.api.layouts);
export const useApiUserPreferences = () =>
  useAppSelector((state) => state.api.userPreferences);
export const useApiLoading = () =>
  useAppSelector((state) => state.api.isLoading);
export const useApiError = () => useAppSelector((state) => state.api.error);

// Widget selectors
export const useWidgetById = (id: string) =>
  useAppSelector((state) =>
    state.dashboard.widgets.find((widget) => widget.id === id)
  );

export const useCurrentLayout = () => {
  const currentLayoutId = useCurrentLayoutId();
  const layouts = useLayouts();
  return layouts.find((layout) => layout.id === currentLayoutId) || null;
};

export const useSelectedWidget = () => {
  const selectedWidgetId = useSelectedWidgetId();
  return useWidgetById(selectedWidgetId || "");
};

// Notification selectors
export const useNotifications = () =>
  useAppSelector((state) => state.notifications.notifications);
export const useUnreadNotificationsCount = () =>
  useAppSelector((state) => state.notifications.unreadCount);
export const useNotificationsLoading = () =>
  useAppSelector((state) => state.notifications.isLoading);
