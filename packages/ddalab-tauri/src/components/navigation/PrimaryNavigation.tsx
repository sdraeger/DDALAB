"use client";

import { useAppStore } from "@/store/appStore";
import { navigationConfig, PrimaryNavTab } from "@/types/navigation";
import {
  Home,
  BarChart3,
  Brain,
  Settings,
  Bell,
  Search,
  Command,
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
};

export function PrimaryNavigation() {
  const primaryNav = useAppStore((state) => state.ui.primaryNav);
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const { openSearch } = useGlobalSearch();

  const handleNavClick = (tab: PrimaryNavTab) => {
    setPrimaryNav(tab);
  };

  return (
    <div className="border-b bg-background" data-testid="primary-navigation">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center space-x-1">
          {Object.values(navigationConfig).map((nav) => {
            const Icon = iconMap[nav.icon as keyof typeof iconMap];
            const isActive = primaryNav === nav.id;

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
                data-nav={nav.id}
                data-active={isActive}
              >
                <Icon className="h-4 w-4" />
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
          >
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Search...</span>
            </div>
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-background border border-border rounded">
              <Command className="h-3 w-3" />
              <span>K</span>
            </kbd>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
