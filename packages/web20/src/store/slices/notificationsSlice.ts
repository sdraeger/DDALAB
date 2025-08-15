import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import apiService from '@/lib/api';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  read: boolean;
  category?: 'system' | 'user' | 'task' | 'security';
  actionUrl?: string;
  actionText?: string;
}

interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
}

const initialState: NotificationsState = {
  notifications: [],
  unreadCount: 0,
  isLoading: false,
};

// Async thunks
const fetchNotifications = createAsyncThunk(
  'notifications/fetchNotifications',
  async () => {
    const response = await apiService.getNotifications();
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!;
  }
);

const fetchUnreadCount = createAsyncThunk(
  'notifications/fetchUnreadCount',
  async () => {
    const response = await apiService.getUnreadNotificationsCount();
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!.count;
  }
);

const markNotificationAsRead = createAsyncThunk(
  'notifications/markAsRead',
  async (notificationId: string) => {
    const response = await apiService.markNotificationAsRead(notificationId);
    if (response.error) {
      throw new Error(response.error);
    }
    return notificationId;
  }
);

const markAllNotificationsAsRead = createAsyncThunk(
  'notifications/markAllAsRead',
  async () => {
    const response = await apiService.markAllNotificationsAsRead();
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!.marked_count;
  }
);

const deleteNotificationAsync = createAsyncThunk(
  'notifications/deleteNotification',
  async (notificationId: string) => {
    const response = await apiService.deleteNotification(notificationId);
    if (response.error) {
      throw new Error(response.error);
    }
    return notificationId;
  }
);

const startMonitoring = createAsyncThunk(
  'notifications/startMonitoring',
  async () => {
    const response = await apiService.startNotificationMonitoring();
    if (response.error) {
      throw new Error(response.error);
    }
    return response.data!;
  }
);

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    setNotifications: (state, action: PayloadAction<Notification[]>) => {
      state.notifications = action.payload;
      state.unreadCount = action.payload.filter(n => !n.read).length;
    },
    addNotification: (state, action: PayloadAction<Notification>) => {
      state.notifications.unshift(action.payload);
      if (!action.payload.read) {
        state.unreadCount += 1;
      }
    },
    markAsRead: (state, action: PayloadAction<string>) => {
      const notification = state.notifications.find(n => n.id === action.payload);
      if (notification && !notification.read) {
        notification.read = true;
        state.unreadCount -= 1;
      }
    },
    markAllAsRead: (state) => {
      state.notifications.forEach(n => n.read = true);
      state.unreadCount = 0;
    },
    removeNotification: (state, action: PayloadAction<string>) => {
      const index = state.notifications.findIndex(n => n.id === action.payload);
      if (index !== -1) {
        const notification = state.notifications[index];
        if (!notification.read) {
          state.unreadCount -= 1;
        }
        state.notifications.splice(index, 1);
      }
    },
    clearNotifications: (state) => {
      state.notifications = [];
      state.unreadCount = 0;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchNotifications
      .addCase(fetchNotifications.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.isLoading = false;
        state.notifications = action.payload;
        state.unreadCount = action.payload.filter(n => !n.read).length;
      })
      .addCase(fetchNotifications.rejected, (state, action) => {
        state.isLoading = false;
        console.error('Failed to fetch notifications:', action.error.message);
      })
      // fetchUnreadCount
      .addCase(fetchUnreadCount.fulfilled, (state, action) => {
        state.unreadCount = action.payload;
      })
      // markNotificationAsRead
      .addCase(markNotificationAsRead.fulfilled, (state, action) => {
        const notification = state.notifications.find(n => n.id === action.payload);
        if (notification && !notification.read) {
          notification.read = true;
          state.unreadCount -= 1;
        }
      })
      // markAllNotificationsAsRead
      .addCase(markAllNotificationsAsRead.fulfilled, (state, action) => {
        state.notifications.forEach(n => n.read = true);
        state.unreadCount = 0;
      })
      // deleteNotificationAsync
      .addCase(deleteNotificationAsync.fulfilled, (state, action) => {
        const index = state.notifications.findIndex(n => n.id === action.payload);
        if (index !== -1) {
          const notification = state.notifications[index];
          if (!notification.read) {
            state.unreadCount -= 1;
          }
          state.notifications.splice(index, 1);
        }
      });
  },
});

export const {
  setNotifications,
  addNotification,
  markAsRead,
  markAllAsRead,
  removeNotification,
  clearNotifications,
  setLoading,
} = notificationsSlice.actions;

// Export async actions
export {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotificationAsync,
  startMonitoring,
};

export default notificationsSlice.reducer;