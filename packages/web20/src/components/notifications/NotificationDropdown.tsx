'use client';

import React, { useEffect } from 'react';
import { Bell, X, Check, CheckCheck, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAppDispatch, useNotifications, useUnreadNotificationsCount } from '@/store/hooks';
import { 
  fetchNotifications, 
  markNotificationAsRead, 
  markAllNotificationsAsRead, 
  deleteNotificationAsync,
  startMonitoring 
} from '@/store/slices/notificationsSlice';
import type { Notification } from '@/store/slices/notificationsSlice';
import { useSearchable, useSearchableItems } from '@/hooks/useSearchable';

const getNotificationIcon = (type: Notification['type']) => {
  switch (type) {
    case 'error':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    default:
      return <Info className="h-4 w-4 text-blue-500" />;
  }
};

const formatTimeAgo = (timestamp: string) => {
  const now = new Date();
  const time = new Date(timestamp);
  const diffInSeconds = Math.floor((now.getTime() - time.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes}m ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days}d ago`;
  }
};

export function NotificationDropdown() {
  const dispatch = useAppDispatch();
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationsCount();

  // Load notifications from API and start monitoring
  useEffect(() => {
    const initializeNotifications = async () => {
      // Fetch existing notifications
      dispatch(fetchNotifications());
      
      // Start monitoring for new notifications
      dispatch(startMonitoring());
    };

    initializeNotifications();
  }, [dispatch]);

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch(fetchNotifications());
    }, 30000);

    return () => clearInterval(interval);
  }, [dispatch]);

  const handleMarkAsRead = (id: string) => {
    dispatch(markNotificationAsRead(id));
  };

  // Make notifications searchable
  const notificationItems = useSearchableItems(
    'notifications',
    'notifications', 
    notifications,
    (notification) => ({
      title: notification.title,
      description: notification.message,
      keywords: [notification.type, notification.category, 'notification'].filter(Boolean),
      icon: getNotificationIcon(notification.type),
      onSelect: () => {
        handleMarkAsRead(notification.id);
        if (notification.actionUrl) {
          window.location.href = notification.actionUrl;
        }
      },
      metadata: {
        type: notification.type,
        read: notification.read,
        timestamp: notification.timestamp,
      },
    })
  );

  useSearchable({
    id: 'notifications',
    category: 'notifications',
    items: notificationItems,
    priority: 6,
  });

  const handleMarkAllAsRead = () => {
    dispatch(markAllNotificationsAsRead());
  };

  const handleRemoveNotification = (id: string) => {
    dispatch(deleteNotificationAsync(id));
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-xs text-white flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleMarkAllAsRead}
                className="text-xs h-auto p-1"
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
          </div>
          {unreadCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "p-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/50 transition-colors",
                  !notification.read && "bg-blue-50/50"
                )}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0">
                    {getNotificationIcon(notification.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "font-medium text-sm truncate",
                          !notification.read && "text-foreground"
                        )}>
                          {notification.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {notification.message}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!notification.read && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkAsRead(notification.id);
                            }}
                            className="h-6 w-6 p-0"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveNotification(notification.id);
                          }}
                          className="h-6 w-6 p-0"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(notification.timestamp)}
                      </span>
                      {notification.category && (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded capitalize">
                          {notification.category}
                        </span>
                      )}
                    </div>
                    
                    {notification.actionText && notification.actionUrl && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-2 h-6 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.location.href = notification.actionUrl!;
                        }}
                      >
                        {notification.actionText}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}