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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

  const renderTabButton = (tabId: string) => {
    const config = secondaryTabConfig[tabId as SecondaryNavTab];
    const Icon = config.icon
      ? iconMap[config.icon as keyof typeof iconMap]
      : null;
    const isActive = secondaryNav === tabId;
    const isEnabled = config.enabled !== false;

    const button = (
      <button
        role="tab"
        onClick={() => isEnabled && setSecondaryNav(tabId as SecondaryNavTab)}
        disabled={!isEnabled}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          isEnabled && "hover:bg-accent/50",
          isActive && isEnabled && "bg-background shadow-sm border",
        )}
        title={isEnabled ? config.description : undefined}
        aria-selected={isActive}
        aria-current={isActive ? "page" : undefined}
        aria-disabled={!isEnabled}
        data-nav={tabId}
        data-active={isActive}
      >
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        {config.label}
        {!isEnabled && (
          <Badge variant="outline" className="ml-1 text-xs py-0 h-4">
            Soon
          </Badge>
        )}
      </button>
    );

    // Wrap disabled tabs with tooltip explaining why
    if (!isEnabled) {
      return (
        <Tooltip key={tabId}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="font-medium">{config.label}</p>
            <p className="text-xs text-muted-foreground">
              This feature is coming soon
            </p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return <span key={tabId}>{button}</span>;
  };

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        className="border-b bg-muted/30"
        data-testid="secondary-navigation"
        aria-label={`${currentCategory.label} navigation`}
      >
        <div className="flex items-center px-6 py-1.5 overflow-x-auto">
          <div role="tablist" className="flex items-center gap-1">
            {secondaryTabs.map(renderTabButton)}
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
}
