# DDALAB Web 2.0 API Integration

## Overview

The DDALAB Web 2.0 application has been fully integrated with the backend API to provide a complete dashboard experience with authentication, data persistence, and real-time statistics.

## Features Implemented

### 🔐 Authentication System

- **Multi-Mode Support**: Supports both local mode (no authentication) and multi-user mode (JWT authentication)
- **Automatic Mode Detection**: Automatically detects the authentication mode from the API
- **Login Form**: Clean, responsive login interface for multi-user mode
- **Token Management**: Automatic JWT token storage and management
- **Logout Functionality**: Secure logout with token cleanup

### 📊 Dashboard Statistics

- **Real-time Stats**: Displays total artifacts, analyses, active users, and system health
- **Visual Indicators**: Color-coded system health badges
- **Loading States**: Smooth loading animations and error handling
- **Auto-refresh**: Statistics are fetched on component mount

### 🎨 User Preferences

- **Theme Management**: Light, dark, and system theme support
- **EEG Zoom Factor**: Adjustable zoom factor for EEG charts (0.01-0.2)
- **API Integration**: All preferences are persisted to the backend
- **Reset Functionality**: Ability to reset preferences to defaults

### 📐 Layout Persistence

- **Grid-based Layouts**: Converts widget positions to grid-based layout format
- **API Storage**: Layouts are saved to and loaded from the backend
- **Auto-save**: Layout changes are automatically persisted
- **Format Conversion**: Handles conversion between widget format and API layout format

## API Endpoints Used

### Authentication

- `GET /api/auth/mode` - Get authentication mode and current user
- `POST /api/auth/token` - Login with username/password
- `POST /api/auth/refresh-token` - Refresh access token

### Dashboard

- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/dashboard/users` - Get all users (admin only)

### Layouts

- `GET /api/layouts` - Get user layouts
- `POST /api/layouts` - Save user layouts
- `DELETE /api/layouts` - Delete user layouts

### User Preferences

- `GET /api/user-preferences` - Get user preferences
- `PUT /api/user-preferences` - Update user preferences
- `DELETE /api/user-preferences` - Reset user preferences

## Architecture

### State Management

The application uses Redux Toolkit with the following slices:

1. **Auth Slice** (`authSlice.ts`)
   - Manages authentication state
   - Handles login/logout
   - Stores user information and tokens

2. **API Slice** (`apiSlice.ts`)
   - Manages API data (stats, layouts, preferences)
   - Handles async operations with loading states
   - Provides error handling

3. **Dashboard Slice** (`dashboardSlice.ts`)
   - Manages widget state and interactions
   - Handles drag/drop and resizing

4. **User Slice** (`userSlice.ts`)
   - Manages UI preferences
   - Handles theme and layout settings

### Components

#### Authentication Components

- `AuthProvider.tsx` - Wraps the app and handles authentication flow
- `LoginForm.tsx` - Login form for multi-user mode

#### Dashboard Components

- `DashboardStats.tsx` - Displays real-time statistics
- `DashboardGrid.tsx` - Widget grid with drag/drop
- `WidgetComponent.tsx` - Individual widget component

#### Settings Components

- `UserPreferences.tsx` - User preferences management

### Services

#### API Service (`lib/api.ts`)

- Centralized API communication
- Token management
- Error handling
- Request/response formatting

#### Layout Persistence Service (`services/LayoutPersistenceService.ts`)

- Converts between widget and layout formats
- Handles layout saving/loading
- Provides auto-save functionality

## Usage Examples

### Authentication Flow

```tsx
// The AuthProvider automatically handles authentication
<AuthProvider>
  <DashboardPage />
</AuthProvider>
```

### Loading Dashboard Stats

```tsx
import { useDashboardStats, useApiLoading } from "@/store/hooks";

function MyComponent() {
  const stats = useDashboardStats();
  const isLoading = useApiLoading();

  if (isLoading) return <div>Loading...</div>;
  if (stats) {
    return <div>Total Artifacts: {stats.totalArtifacts}</div>;
  }
}
```

### Managing User Preferences

```tsx
import { useAppDispatch, useApiUserPreferences } from "@/store/hooks";
import { updateUserPreferences } from "@/store/slices/apiSlice";

function MyComponent() {
  const dispatch = useAppDispatch();
  const preferences = useApiUserPreferences();

  const handleThemeChange = (theme: "light" | "dark" | "system") => {
    dispatch(updateUserPreferences({ theme }));
  };
}
```

### Layout Persistence

```tsx
import { layoutPersistenceService } from "@/services/LayoutPersistenceService";

// Save layout
await layoutPersistenceService.saveCurrentLayout(widgets);

// Load layout
const savedWidgets = await layoutPersistenceService.loadLayout();
```

## Configuration

### Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### API Base URL

The application defaults to `http://localhost:8000` if no API URL is provided.

## Error Handling

- **Network Errors**: Graceful handling of network failures
- **Authentication Errors**: Clear error messages for login failures
- **API Errors**: Proper error states for all API operations
- **Loading States**: Loading indicators for all async operations

## Security Features

- **JWT Token Storage**: Secure token storage in localStorage
- **Automatic Token Refresh**: Handles token expiration
- **CORS Support**: Proper CORS configuration for API communication
- **Input Validation**: Form validation and sanitization

## Performance Optimizations

- **Memoized Selectors**: Optimized Redux selectors to prevent unnecessary re-renders
- **Lazy Loading**: Components load data only when needed
- **Error Boundaries**: Graceful error handling without app crashes
- **Loading States**: Smooth user experience during data fetching

## Testing Considerations

- **Mock API Service**: Easy to mock for testing
- **Redux DevTools**: Full Redux DevTools support for debugging
- **Error Scenarios**: Comprehensive error handling for testing
- **Loading States**: Testable loading and error states

## Future Enhancements

1. **Real-time Updates**: WebSocket integration for live data
2. **Offline Support**: Service worker for offline functionality
3. **Advanced Layouts**: More complex layout configurations
4. **Widget Marketplace**: Dynamic widget loading system
5. **Analytics**: User behavior tracking and analytics

## Troubleshooting

### Common Issues

1. **API Connection Failed**
   - Check `NEXT_PUBLIC_API_URL` environment variable
   - Verify API server is running
   - Check CORS configuration

2. **Authentication Issues**
   - Verify auth mode in API configuration
   - Check JWT token expiration
   - Clear localStorage if needed

3. **Layout Not Saving**
   - Check API permissions
   - Verify layout format conversion
   - Check network connectivity

### Debug Tools

- Redux DevTools for state inspection
- Browser Network tab for API calls
- Console logs for detailed error information
