"use client";

import { useAppStore } from "@/store/appStore";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { navigationConfig, PrimaryNavTab } from "@/types/navigation";
import {
  Home,
  BarChart3,
  Brain,
  Settings,
  Bell,
  Search,
  Command,
  Database,
  Users,
  Puzzle,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useGlobalSearch } from "@/components/GlobalSearchProvider";

const iconMap = {
  Home,
  BarChart3,
  Brain,
  Settings,
  Bell,
  Database,
  Users,
  Puzzle,
  GraduationCap,
};

export function PrimaryNavigation() {
  const primaryNav = useAppStore((state) => state.ui.primaryNav);
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const unreadCount = useUnreadNotificationCount();
  const { openSearch } = useGlobalSearch();

  const handleNavClick = (tab: PrimaryNavTab) => {
    setPrimaryNav(tab);
  };

  const formatBadgeCount = (count: number): string | null => {
    if (count === 0) return null;
    if (count > 99) return "99+";
    return count.toString();
  };

  return (
    <div className="border-b bg-background" data-testid="primary-navigation">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center space-x-1">
          {Object.values(navigationConfig).map((nav) => {
            const Icon = iconMap[nav.icon as keyof typeof iconMap];
            const isActive = primaryNav === nav.id;

            const badgeCount =
              nav.id === "notifications" ? formatBadgeCount(unreadCount) : null;

            return (
              <button
                key={nav.id}
                onClick={() => handleNavClick(nav.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive && "bg-accent text-accent-foreground",
                )}
                title={nav.description}
                aria-label={nav.label}
                data-nav={nav.id}
                data-active={isActive}
                data-tour={nav.id === "settings" ? "settings-tab" : undefined}
              >
                <span className="relative">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {badgeCount && (
                    <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 text-[10px] font-semibold text-white bg-red-500 rounded-full">
                      {badgeCount}
                    </span>
                  )}
                </span>
                {nav.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openSearch}
            className={cn(
              "flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              "bg-muted/50 hover:bg-muted border border-border",
              "hover:shadow-sm active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "min-w-[200px] justify-between",
            )}
            title="Search (⌘K / Ctrl+K)"
            aria-label="Search"
          >
            <div className="flex items-center gap-2">
              <Search
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">Search...</span>
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-background border border-border rounded">
              <Command className="h-3 w-3" aria-hidden="true" />
              <span>K</span>
            </kbd>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
