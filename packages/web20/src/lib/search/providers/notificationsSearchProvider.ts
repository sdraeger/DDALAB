import { SearchProvider, SearchableItem } from '@/types/search';
import { Bell, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react';
import React from 'react';

const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'error':
      return React.createElement(AlertCircle, { className: 'h-4 w-4 text-red-500' });
    case 'warning':
      return React.createElement(AlertTriangle, { className: 'h-4 w-4 text-yellow-500' });
    case 'success':
      return React.createElement(CheckCircle, { className: 'h-4 w-4 text-green-500' });
    default:
      return React.createElement(Info, { className: 'h-4 w-4 text-blue-500' });
  }
};

// This provider is now handled by the NotificationDropdown component
// using the useSearchable hook, so this file is kept for reference only

export function createNotificationsSearchProvider(
  getNotifications: () => any[]
): SearchProvider {
  return {
    id: 'notifications-legacy',
    name: 'Notifications (Legacy)',
    category: 'notifications',
    priority: 0, // Lower priority since this is legacy
    search: (query: string): SearchableItem[] => {
      // This provider is deprecated in favor of component-based registration
      return [];
    },
  };
}