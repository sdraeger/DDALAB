"use client";

import { useState, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  useNotificationStore,
  Notification,
  NotificationType,
  NotificationCategory,
} from "@/store/notificationStore";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Trash2,
  MoreHorizontal,
  Info,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Filter,
  RefreshCw,
  FileText,
  BarChart3,
  Cloud,
  Download,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icon mapping for notification types
const typeIcons: Record<NotificationType, React.ElementType> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const typeColors: Record<NotificationType, string> = {
  info: "text-blue-500",
  success: "text-green-500",
  warning: "text-yellow-500",
  error: "text-red-500",
};

const typeBgColors: Record<NotificationType, string> = {
  info: "bg-blue-500/10",
  success: "bg-green-500/10",
  warning: "bg-yellow-500/10",
  error: "bg-red-500/10",
};

// Icon mapping for categories
const categoryIcons: Record<NotificationCategory, React.ElementType> = {
  system: Settings,
  analysis: BarChart3,
  file: FileText,
  sync: Cloud,
  update: Download,
};

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 10) return `${seconds}s ago`;
  return "Just now";
}

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: () => void;
  onRemove: () => void;
}

function NotificationItem({
  notification,
  onMarkRead,
  onRemove,
}: NotificationItemProps) {
  const Icon = typeIcons[notification.type];
  const CategoryIcon = categoryIcons[notification.category];

  return (
    <div
      className={cn(
        "group relative px-4 py-3 border-b last:border-b-0 transition-colors",
        !notification.read && "bg-accent/50",
        notification.read && "opacity-70",
      )}
    >
      <div className="flex gap-3">
        {/* Type icon */}
        <div
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
            typeBgColors[notification.type],
          )}
        >
          <Icon className={cn("h-4 w-4", typeColors[notification.type])} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">
                  {notification.title}
                </span>
                {!notification.read && (
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                )}
              </div>
              {notification.message && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {notification.message}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                <CategoryIcon className="h-3 w-3" />
                <span className="capitalize">{notification.category}</span>
                <span>•</span>
                <span>{formatTimestamp(notification.timestamp)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!notification.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead();
                  }}
                  title="Mark as read"
                >
                  <Check className="h-3 w-3" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface NotificationCenterProps {
  className?: string;
}

export function NotificationCenter({ className }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");

  const notifications = useNotificationStore((s) => s.notifications);
  const filters = useNotificationStore((s) => s.filters);
  const getFilteredNotifications = useNotificationStore(
    (s) => s.getFilteredNotifications,
  );
  const getUnreadCount = useNotificationStore((s) => s.getUnreadCount);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const clearRead = useNotificationStore((s) => s.clearRead);
  const setFilters = useNotificationStore((s) => s.setFilters);

  const unreadCount = getUnreadCount();

  const displayedNotifications = useMemo(() => {
    let result = getFilteredNotifications();
    if (activeTab === "unread") {
      result = result.filter((n) => !n.read);
    }
    return result;
  }, [activeTab, getFilteredNotifications]);

  const toggleTypeFilter = (type: NotificationType) => {
    const newTypes = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type];
    setFilters({ types: newTypes });
  };

  const toggleCategoryFilter = (category: NotificationCategory) => {
    const newCategories = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category];
    setFilters({ categories: newCategories });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("relative h-8 w-8 p-0", className)}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          <div className="flex items-center gap-1">
            {/* Filter menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <Filter className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Types
                </div>
                {(
                  ["info", "success", "warning", "error"] as NotificationType[]
                ).map((type) => (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={filters.types.includes(type)}
                    onCheckedChange={() => toggleTypeFilter(type)}
                    className="capitalize"
                  >
                    {type}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Categories
                </div>
                {(
                  [
                    "system",
                    "analysis",
                    "file",
                    "sync",
                    "update",
                  ] as NotificationCategory[]
                ).map((category) => (
                  <DropdownMenuCheckboxItem
                    key={category}
                    checked={filters.categories.includes(category)}
                    onCheckedChange={() => toggleCategoryFilter(category)}
                    className="capitalize"
                  >
                    {category}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* More actions menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={markAllAsRead}>
                  <CheckCheck className="h-4 w-4 mr-2" />
                  Mark all as read
                </DropdownMenuItem>
                <DropdownMenuItem onClick={clearRead}>
                  <BellOff className="h-4 w-4 mr-2" />
                  Clear read notifications
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={clearAll}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "all" | "unread")}
          className="w-full"
        >
          <TabsList className="w-full rounded-none border-b h-9">
            <TabsTrigger value="all" className="flex-1 text-xs">
              All
            </TabsTrigger>
            <TabsTrigger value="unread" className="flex-1 text-xs">
              Unread
              {unreadCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-4 px-1 text-[10px]"
                >
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-0">
            <ScrollArea className="h-[350px]">
              {displayedNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Bell className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">
                    {activeTab === "unread"
                      ? "No unread notifications"
                      : "No notifications"}
                  </p>
                  {notifications.length > 0 &&
                    displayedNotifications.length === 0 && (
                      <p className="text-xs mt-1">Try adjusting your filters</p>
                    )}
                </div>
              ) : (
                displayedNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkRead={() => markAsRead(notification.id)}
                    onRemove={() => removeNotification(notification.id)}
                  />
                ))
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

// Inline notification toast-like component for temporary display
interface NotificationToastProps {
  notification: Notification;
  onDismiss: () => void;
}

export function NotificationToast({
  notification,
  onDismiss,
}: NotificationToastProps) {
  const Icon = typeIcons[notification.type];

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border shadow-lg max-w-sm",
        typeBgColors[notification.type],
      )}
    >
      <Icon
        className={cn("h-5 w-5 flex-shrink-0", typeColors[notification.type])}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{notification.title}</p>
        {notification.message && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {notification.message}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 flex-shrink-0"
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
