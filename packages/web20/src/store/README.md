# Redux Toolkit State Management

This directory contains the Redux Toolkit implementation for the DDALAB dashboard application. The state management has been migrated from Zustand to Redux Toolkit to provide better developer experience, type safety, and adherence to SOLID principles.

## Architecture Overview

### SOLID Principles Implementation

1. **Single Responsibility Principle (SRP)**: Each slice handles a specific domain of the application state
2. **Open/Closed Principle (OCP)**: New features can be added through new slices without modifying existing ones
3. **Liskov Substitution Principle (LSP)**: All slices follow the same Redux Toolkit pattern
4. **Interface Segregation Principle (ISP)**: Custom hooks provide specific selectors for different use cases
5. **Dependency Inversion Principle (DIP)**: Components depend on abstractions (hooks) rather than concrete implementations

## File Structure

```
src/store/
├── index.ts              # Store configuration and types
├── hooks.ts              # Custom typed hooks for Redux
├── providers/
│   └── StoreProvider.tsx # Redux Provider component
├── slices/
│   ├── dashboardSlice.ts # Dashboard state management
│   └── userSlice.ts      # User state management
└── README.md            # This file
```

## Store Configuration

The store is configured with:

- **Redux Toolkit**: For simplified Redux development
- **TypeScript**: For type safety
- **DevTools**: For development debugging
- **Serializable Check**: With exceptions for drag/resize state
- **Immutable Check**: With exceptions for complex state objects

## Slices

### Dashboard Slice (`dashboardSlice.ts`)

Manages dashboard-specific state including:

- Widgets (add, update, remove, move, resize)
- Layouts (add, update, remove, set current)
- Selection state (selected widget, drag state, resize state)
- Settings (grid size, snapping, collision detection)
- Widget state management (minimize, maximize, restore, pop out/in)

### User Slice (`userSlice.ts`)

Manages user-specific state including:

- User authentication and profile
- UI preferences (sidebar, header, footer visibility)
- Theme settings (light, dark, system)
- Dashboard settings and preferences

## Custom Hooks

### Core Hooks

- `useAppDispatch()`: Typed dispatch function
- `useAppSelector`: Typed selector hook

### Dashboard Hooks

- `useDashboardState()`: Complete dashboard state
- `useWidgets()`: All widgets
- `useLayouts()`: All layouts
- `useCurrentLayoutId()`: Current layout ID
- `useSelectedWidgetId()`: Selected widget ID
- `useIsDragging()`: Drag state
- `useIsResizing()`: Resize state
- `useDragState()`: Current drag state
- `useResizeState()`: Current resize state
- `useDashboardSettings()`: Dashboard settings
- `useWidgetById(id)`: Specific widget by ID
- `useCurrentLayout()`: Current layout object
- `useSelectedWidget()`: Selected widget object

### User Hooks

- `useUserState()`: Complete user state
- `useUser()`: Current user object
- `useIsAuthenticated()`: Authentication status
- `useUserPreferences()`: User preferences
- `useSidebarCollapsed()`: Sidebar collapsed state
- `useHeaderVisible()`: Header visibility
- `useFooterVisible()`: Footer visibility
- `useTheme()`: Current theme

## Usage Examples

### Basic Component Usage

```tsx
import { useAppDispatch, useWidgets } from "@/store/hooks";
import { addWidget } from "@/store/slices/dashboardSlice";

function MyComponent() {
  const dispatch = useAppDispatch();
  const widgets = useWidgets();

  const handleAddWidget = () => {
    dispatch(
      addWidget({
        id: "widget-1",
        title: "New Widget",
        type: "chart",
        position: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
      })
    );
  };

  return (
    <div>
      <button onClick={handleAddWidget}>Add Widget</button>
      <div>Widget count: {widgets.length}</div>
    </div>
  );
}
```

### Advanced Selector Usage

```tsx
import { useSelectedWidget, useDashboardSettings } from "@/store/hooks";

function WidgetEditor() {
  const selectedWidget = useSelectedWidget();
  const settings = useDashboardSettings();

  if (!selectedWidget) {
    return <div>No widget selected</div>;
  }

  return (
    <div>
      <h3>Editing: {selectedWidget.title}</h3>
      <div>Grid Size: {settings.gridSize}</div>
      <div>Snapping: {settings.enableSnapping ? "On" : "Off"}</div>
    </div>
  );
}
```

## Migration from Zustand

The migration from Zustand to Redux Toolkit provides:

1. **Better TypeScript Support**: Full type safety with custom hooks
2. **Standardized Patterns**: Consistent Redux patterns across the application
3. **Better DevTools**: Enhanced debugging capabilities
4. **Modularity**: Clear separation of concerns with slices
5. **Scalability**: Easy to add new features without affecting existing code

### Key Changes

- Replaced `useDashboardStore()` with specific hooks like `useWidgets()`, `useSelectedWidgetId()`
- Replaced direct state mutations with dispatched actions
- Added comprehensive TypeScript types
- Implemented proper action creators with payload types
- Added middleware configuration for complex state objects

## Best Practices

1. **Use Custom Hooks**: Always use the provided custom hooks instead of raw `useSelector`
2. **Type Actions**: Always provide proper TypeScript types for action payloads
3. **Keep Slices Focused**: Each slice should handle a specific domain
4. **Use Immutable Updates**: Leverage Redux Toolkit's Immer integration
5. **Handle Loading States**: Implement proper loading and error states
6. **Optimize Selectors**: Use specific selectors to avoid unnecessary re-renders

## Performance Considerations

- Custom hooks are memoized to prevent unnecessary re-renders
- Selectors are optimized to return stable references when possible
- Complex state objects (drag/resize state) are excluded from serialization checks
- DevTools are only enabled in development mode

## Testing

The Redux Toolkit setup supports testing with:

- Jest for unit testing
- Redux Toolkit's built-in testing utilities
- Mock store for component testing
- Action creators for predictable state changes

## Future Enhancements

1. **Persistence**: Add Redux Persist for state persistence
2. **Middleware**: Add custom middleware for logging, analytics, etc.
3. **Async Actions**: Implement RTK Query for API calls
4. **Optimistic Updates**: Add optimistic update patterns
5. **Undo/Redo**: Implement undo/redo functionality
