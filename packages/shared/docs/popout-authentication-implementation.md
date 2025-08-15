# Popout Authentication Implementation Summary

## Task 5: Fix authentication context in pop-out windows

### Implementation Overview

This document summarizes the implementation of secure authentication context for pop-out windows, addressing requirements 2.4 and 5.5.

### ✅ Completed Sub-tasks

#### 1. Pass authentication tokens to pop-out windows securely

**Implementation:**

- Enhanced `PopoutDataSyncService.getAuthToken()` to retrieve tokens from multiple sources:
  - Redux store (`state.auth.user.accessToken`)
  - NextAuth session storage
  - Local mode tokens from localStorage
  - Auth mode context detection

**Files Modified:**

- `packages/shared/services/PopoutDataSyncService.ts`
- `packages/shared/hooks/usePopoutDataSync.ts`

**Security Features:**

- Tokens stored in sessionStorage for popout windows
- Secure message passing between windows
- Token validation before use

#### 2. Implement token refresh mechanism for pop-out windows

**Implementation:**

- Created `usePopoutAuth` hook for managing authentication in popout windows
- Created `PopoutAuthManager` service for handling token refresh requests from main window
- Implemented automatic token refresh scheduling based on expiration

**Files Created:**

- `packages/shared/hooks/usePopoutAuth.ts`
- `packages/shared/services/PopoutAuthManager.ts`

**Key Features:**

- Automatic token validation and expiration checking
- Scheduled refresh 2 minutes before token expiry
- Timeout handling for refresh requests (10 second timeout)
- Fallback error handling for failed refreshes

#### 3. Add session data synchronization between windows

**Implementation:**

- Enhanced session data collection in `PopoutDataSyncService.getSessionData()`
- Comprehensive session restoration in `usePopoutDataSync`
- Real-time auth updates broadcast to all popout windows

**Session Data Synchronized:**

- NextAuth session data
- Local session data
- Auth mode context
- User preferences
- All relevant sessionStorage items

**Files Modified:**

- `packages/shared/services/PopoutDataSyncService.ts`
- `packages/shared/hooks/usePopoutDataSync.ts`
- `packages/shared/store/index.ts`

### 🔧 Integration Points

#### Widget Integration

Updated all widgets to use the new authentication context:

**Files Modified:**

- `packages/shared/components/dashboard/widgets/DDAWidget.tsx`
- `packages/shared/components/dashboard/widgets/ChartWidget.tsx`
- `packages/shared/components/dashboard/widgets/DDAHeatmapWidget.tsx`
- `packages/shared/components/dashboard/widgets/DDALinePlotWidget.tsx`

**Integration Features:**

- Widgets now receive `widgetId` and `isPopout` props
- Authentication state managed through `usePopoutAuth` hook
- Proper error handling for authentication failures
- Token prioritization (popout auth for popout windows, session auth for main window)

#### Popout Window Management

Enhanced popout window creation and management:

**Files Modified:**

- `packages/shared/hooks/useDashboard.ts`
- `packages/shared/hooks/usePersistentDashboard.ts`
- `packages/shared/lib/utils/widgetFactory.tsx`
- `packages/web/app/widget/[id]/page.tsx`

**Management Features:**

- Automatic registration of popout windows with auth manager
- Cleanup of closed windows from auth manager
- Enhanced widget page with authentication status
- Loading states that include authentication progress

### 🔒 Security Measures

1. **Token Storage:**

   - Tokens stored in sessionStorage (cleared on window close)
   - No sensitive data in localStorage for popout context
   - Secure message passing with origin validation

2. **Token Validation:**

   - JWT token expiration checking
   - Local mode token validation
   - Automatic refresh scheduling
   - Timeout protection for refresh requests

3. **Error Handling:**
   - Graceful degradation on authentication failures
   - User-friendly error messages
   - Automatic cleanup on window close
   - Fallback to main window on critical errors

### 🧪 Testing

Created comprehensive test suite:

**File Created:**

- `packages/shared/tests/popout-auth.test.ts`

**Test Coverage:**

- Authentication token management
- Token refresh mechanism
- Session data synchronization
- Local mode authentication
- Error handling scenarios
- Integration test verification

### 📋 Requirements Verification

#### Requirement 2.4: Authentication Context

✅ **COMPLETED** - Authentication tokens are securely passed to popout windows and maintained throughout the session.

#### Requirement 5.5: Session Synchronization

✅ **COMPLETED** - Session data is synchronized between main and popout windows with real-time updates.

### 🚀 Usage Examples

#### For Widget Developers

```typescript
// In a widget component
const { isAuthenticated, tokenInfo, refreshToken } = usePopoutAuth({
  widgetId: "my-widget-id",
  isPopout: true,
  onAuthError: (error) => console.error("Auth error:", error),
  onTokenRefresh: (token) => console.log("Token refreshed"),
});

// Use authentication state
if (!isAuthenticated) {
  return <div>Please authenticate...</div>;
}

// Make authenticated API calls
const token = tokenInfo.token;
```

#### For Main Window Integration

```typescript
// PopoutAuthManager is automatically initialized
// Popout windows are automatically registered
// Token refresh requests are handled automatically
```

### 🔄 Automatic Processes

1. **Token Refresh Scheduling:**

   - Automatically schedules refresh 2 minutes before expiry
   - Handles both JWT and custom token formats
   - Graceful handling of refresh failures

2. **Session Synchronization:**

   - Real-time updates broadcast to all popout windows
   - Automatic cleanup of closed windows
   - Comprehensive session data restoration

3. **Error Recovery:**
   - Automatic retry mechanisms
   - Fallback authentication methods
   - User notification of authentication issues

### ✅ Task Completion Status

**Task 5: Fix authentication context in pop-out windows - COMPLETED**

All sub-tasks have been implemented and tested:

- ✅ Pass authentication tokens to pop-out windows securely
- ✅ Implement token refresh mechanism for pop-out windows
- ✅ Add session data synchronization between windows

The implementation provides a robust, secure, and user-friendly authentication system for popout windows that maintains session continuity and handles edge cases gracefully.
