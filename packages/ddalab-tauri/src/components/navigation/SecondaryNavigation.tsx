"use client";

import { useAppStore } from "@/store/appStore";
import {
  navigationConfig,
  secondaryTabConfig,
  SecondaryNavTab,
} from "@/types/navigation";
import {
  Activity,
  MessageSquare,
  Waves,
  LineChart,
  Brain,
  Cpu,
  Network,
  TrendingUp,
  Settings,
  Database,
  Cloud,
  Bell,
  Filter,
  Sparkles,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const iconMap = {
  Activity,
  MessageSquare,
  Waves,
  LineChart,
  Brain,
  Cpu,
  Network,
  TrendingUp,
  Settings,
  Database,
  Cloud,
  Bell,
  Filter,
  Sparkles,
  Radio,
};

export function SecondaryNavigation() {
  const primaryNav = useAppStore((state) => state.ui.primaryNav);
  const secondaryNav = useAppStore((state) => state.ui.secondaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);

  const currentCategory = navigationConfig[primaryNav];
  const secondaryTabs = currentCategory.secondaryTabs;

  if (!secondaryTabs || secondaryTabs.length === 0) {
    return null;
  }

  return (
    <div className="border-b bg-muted/30" data-testid="secondary-navigation">
      <div className="flex items-center px-6 py-1.5 overflow-x-auto">
        <div className="flex items-center gap-1">
          {secondaryTabs.map((tabId) => {
            const config = secondaryTabConfig[tabId];
            const Icon = config.icon
              ? iconMap[config.icon as keyof typeof iconMap]
              : null;
            const isActive = secondaryNav === tabId;
            const isEnabled = config.enabled !== false;

            return (
              <button
                key={tabId}
                onClick={() => isEnabled && setSecondaryNav(tabId)}
                disabled={!isEnabled}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  isEnabled && "hover:bg-accent/50",
                  isActive && isEnabled && "bg-background shadow-sm border",
                )}
                title={config.description}
                data-nav={tabId}
                data-active={isActive}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {config.label}
                {!isEnabled && (
                  <Badge variant="outline" className="ml-1 text-xs py-0 h-4">
                    Soon
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
