"use client";

import * as React from "react";
import { ChevronRight, Home, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  isCurrent?: boolean;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  maxItems?: number; // Max items to show before collapsing
  separator?: React.ReactNode;
  className?: string;
  homeIcon?: boolean;
  onHomeClick?: () => void;
}

export function Breadcrumb({
  items,
  maxItems = 4,
  separator,
  className,
  homeIcon = true,
  onHomeClick,
}: BreadcrumbProps) {
  const [collapsed, setCollapsed] = React.useState<BreadcrumbItem[]>([]);
  const [visible, setVisible] = React.useState<BreadcrumbItem[]>(items);

  React.useEffect(() => {
    if (items.length > maxItems) {
      // Keep first and last items, collapse middle
      const firstItem = items[0];
      const lastItems = items.slice(-(maxItems - 1));
      const middleItems = items.slice(1, -(maxItems - 1));

      setCollapsed(middleItems);
      setVisible([firstItem, ...lastItems]);
    } else {
      setCollapsed([]);
      setVisible(items);
    }
  }, [items, maxItems]);

  const renderSeparator = () => {
    if (separator) return separator;
    return (
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
    );
  };

  const renderItem = (item: BreadcrumbItem, index: number) => {
    const isLast = index === visible.length - 1;
    const isClickable = item.onClick || item.href;

    return (
      <React.Fragment key={index}>
        {index > 0 && renderSeparator()}
        <li className="flex items-center">
          {isClickable && !isLast ? (
            <button
              onClick={item.onClick}
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium transition-colors",
                "text-muted-foreground hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                "rounded px-1 -mx-1",
              )}
            >
              {item.icon}
              <span className="truncate max-w-[150px]">{item.label}</span>
            </button>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1.5 text-sm",
                isLast
                  ? "text-foreground font-semibold bg-primary/10 px-2 py-0.5 rounded-md"
                  : "text-muted-foreground font-medium",
              )}
              aria-current={isLast ? "page" : undefined}
            >
              {item.icon}
              <span className="truncate max-w-[200px]">{item.label}</span>
            </span>
          )}
        </li>
      </React.Fragment>
    );
  };

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center", className)}>
      <ol className="flex items-center gap-1.5">
        {/* Home icon */}
        {homeIcon && (
          <>
            <li>
              <button
                onClick={onHomeClick}
                className={cn(
                  "p-1 rounded transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                title="Home"
              >
                <Home className="h-4 w-4" />
              </button>
            </li>
            {visible.length > 0 && renderSeparator()}
          </>
        )}

        {/* First item */}
        {visible.length > 0 && renderItem(visible[0], 0)}

        {/* Collapsed items dropdown */}
        {collapsed.length > 0 && (
          <>
            {renderSeparator()}
            <li>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Show more</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {collapsed.map((item, index) => (
                    <DropdownMenuItem
                      key={index}
                      onClick={item.onClick}
                      className="flex items-center gap-2"
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          </>
        )}

        {/* Remaining visible items */}
        {visible.slice(1).map((item, index) => renderItem(item, index + 1))}
      </ol>
    </nav>
  );
}

// File path specific breadcrumb
export function FileBreadcrumb({
  path,
  onNavigate,
  className,
}: {
  path: string[];
  onNavigate: (path: string[]) => void;
  className?: string;
}) {
  const items: BreadcrumbItem[] = path.map((segment, index) => ({
    label: segment,
    onClick: () => onNavigate(path.slice(0, index + 1)),
    isCurrent: index === path.length - 1,
  }));

  return (
    <Breadcrumb
      items={items}
      className={className}
      homeIcon={true}
      onHomeClick={() => onNavigate([])}
      maxItems={5}
    />
  );
}
