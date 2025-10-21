'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Trash2,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import { TauriService, Notification, NotificationType } from '@/services/tauriService'
import { formatDistanceToNow } from 'date-fns'

interface NotificationHistoryProps {
  onNavigate?: (actionType: string, actionData: any) => void
}

export function NotificationHistory({ onNavigate }: NotificationHistoryProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadNotifications = useCallback(async () => {
    try {
      setError(null)
      const [notifs, count] = await Promise.all([
        TauriService.listNotifications(50),
        TauriService.getUnreadCount(),
      ])
      setNotifications(notifs)
      setUnreadCount(count)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications')
      console.error('[NOTIFICATIONS] Failed to load:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!TauriService.isTauri()) return

    loadNotifications()

    // Poll for new notifications every 5 seconds
    const interval = setInterval(loadNotifications, 5000)

    return () => clearInterval(interval)
  }, [loadNotifications])

  const handleNotificationClick = async (notification: Notification) => {
    try {
      // Mark as read
      if (!notification.read) {
        await TauriService.markNotificationRead(notification.id)
        await loadNotifications()
      }

      // Handle navigation if action type is present
      if (notification.action_type && onNavigate) {
        onNavigate(notification.action_type, notification.action_data)
      }
    } catch (err) {
      console.error('[NOTIFICATIONS] Failed to handle click:', err)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await TauriService.markAllNotificationsRead()
      await loadNotifications()
    } catch (err) {
      console.error('[NOTIFICATIONS] Failed to mark all read:', err)
    }
  }

  const handleDeleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent notification click
    try {
      await TauriService.deleteNotification(id)
      await loadNotifications()
    } catch (err) {
      console.error('[NOTIFICATIONS] Failed to delete:', err)
    }
  }

  const handleCleanupOld = async () => {
    try {
      const deleted = await TauriService.deleteOldNotifications(30) // Delete older than 30 days
      console.log(`[NOTIFICATIONS] Deleted ${deleted} old notifications`)
      await loadNotifications()
    } catch (err) {
      console.error('[NOTIFICATIONS] Failed to cleanup:', err)
    }
  }

  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case NotificationType.Success:
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case NotificationType.Error:
        return <AlertCircle className="h-5 w-5 text-red-500" />
      case NotificationType.Warning:
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      case NotificationType.Info:
      default:
        return <Info className="h-5 w-5 text-blue-500" />
    }
  }

  const getNotificationBadgeColor = (type: NotificationType) => {
    switch (type) {
      case NotificationType.Success:
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      case NotificationType.Error:
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
      case NotificationType.Warning:
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
      case NotificationType.Info:
      default:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
    }
  }

  if (!TauriService.isTauri()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Notifications are only available in the Tauri app</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {unreadCount} new
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Recent system notifications and updates
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllRead}
              >
                <CheckCheck className="h-4 w-4 mr-2" />
                Mark all read
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCleanupOld}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clean up old
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="text-red-500 text-sm mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-2">
            <BellOff className="h-12 w-12 opacity-50" />
            <p>No notifications yet</p>
          </div>
        ) : (
          <div className="h-[600px] overflow-auto pr-4">
            <div className="space-y-3">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`
                    p-4 rounded-lg border transition-all cursor-pointer
                    ${notification.read
                      ? 'bg-muted/20 border-muted'
                      : 'bg-background border-primary/20 shadow-sm'
                    }
                    hover:border-primary/50 hover:shadow-md
                  `}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {getNotificationIcon(notification.notification_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                          {notification.title}
                          {!notification.read && (
                            <span className="h-2 w-2 rounded-full bg-primary" />
                          )}
                        </h4>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${getNotificationBadgeColor(notification.notification_type)}`}
                        >
                          {notification.notification_type}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {notification.message}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </span>
                        <div className="flex items-center gap-2">
                          {notification.action_type && (
                            <Badge variant="outline" className="text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              Click to view
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => handleDeleteNotification(notification.id, e)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
