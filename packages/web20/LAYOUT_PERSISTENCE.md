# Layout Persistence Implementation

## Overview

This implementation ensures that widget layout changes (additions, removals, and position changes) are automatically persisted to the database and restored on page reload.

## Key Components

### 1. LayoutPersistenceService (`src/services/LayoutPersistenceService.ts`)

- **Auto-save functionality**: Automatically saves layout changes after 2 seconds of inactivity
- **Database integration**: Saves to `/api/widget-layouts` endpoint in multi-user mode
- **Local storage fallback**: Uses localStorage in local mode
- **Change detection**: Only saves when layout has actually changed

### 2. useLayoutPersistence Hook (`src/hooks/useLayoutPersistence.ts`)

- **Redux integration**: Connects persistence service with Redux store
- **Authentication handling**: Manages access tokens for database operations
- **Auto-loading**: Automatically loads saved layouts on component mount
- **Enhanced widget management**: Provides persistence-aware widget operations

### 3. Updated Components

- **DashboardGrid**: Now uses persistence-aware widget removal
- **WidgetComponent**: Uses persistence hook for widget removal
- **Dashboard Page**: Integrated with layout persistence system

## How It Works

### Widget Removal Flow

1. User clicks "Remove" in widget dropdown menu
2. `WidgetComponent` calls `removeWidget` from `useLayoutPersistence`
3. Hook dispatches Redux action to remove widget from state
4. Auto-save timer is scheduled (2-second delay)
5. Layout is automatically saved to database/localStorage

### Layout Loading Flow

1. On page load, `useLayoutPersistence` checks for saved layout
2. If found, loads from database/localStorage
3. Dispatches Redux action to restore widgets
4. If no saved layout, sample widgets are added

### Auto-Save Flow

1. Any widget state change triggers auto-save scheduling
2. Timer waits 2 seconds for additional changes
3. If no more changes, layout is saved to database
4. Change detection prevents unnecessary saves

## Testing

### Test Cases

1. **Widget Removal Persistence**
   - Add widgets to dashboard
   - Remove a widget using the dropdown menu
   - Refresh the page
   - **Expected**: Widget should remain removed

2. **Widget Position Persistence**
   - Drag a widget to a new position
   - Refresh the page
   - **Expected**: Widget should be in the new position

3. **Layout Loading**
   - Create a layout with multiple widgets
   - Save the layout
   - Clear browser data or use a different browser
   - Load the page
   - **Expected**: Saved layout should be restored

4. **Auto-Save Functionality**
   - Make multiple rapid changes to widgets
   - Wait 2 seconds
   - Check browser network tab
   - **Expected**: Only one save request should be made

### Manual Testing Steps

1. Start the web20 application:

   ```bash
   cd packages/web20
   npm run dev
   ```

2. Open the dashboard and verify:
   - Sample widgets are loaded on first visit
   - Widget removal works and persists on refresh
   - Manual save/load/clear buttons work
   - Debug info shows correct widget count and initialization status

3. Test widget removal:
   - Click the three-dot menu on any widget
   - Select "Remove"
   - Refresh the page
   - Verify widget remains removed

4. Test auto-save:
   - Make changes to widget positions
   - Wait 2 seconds
   - Check browser console for save confirmation
   - Refresh page to verify persistence

## Database Schema

The layout data is stored in the `user_layouts` table:

```sql
CREATE TABLE public.user_layouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES public.users(id),
    layout_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

- `POST /api/widget-layouts` - Save widget layout
- `GET /api/widget-layouts` - Load widget layout
- `DELETE /api/widget-layouts` - Delete widget layout

## Configuration

The system supports both local and multi-user modes:

- **Local Mode**: Uses localStorage for persistence
- **Multi-User Mode**: Uses database with authentication

Mode is automatically detected based on authentication state.

## Error Handling

- Network errors are logged and don't break the UI
- Failed saves are retried on next change
- Local storage fallback for offline scenarios
- Graceful degradation when database is unavailable
