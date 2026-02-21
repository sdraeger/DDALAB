import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

const statCardVariants = cva("border-l-4", {
  variants: {
    accentColor: {
      blue: "border-l-blue-500 dark:border-l-blue-400",
      green: "border-l-green-500 dark:border-l-green-400",
      orange: "border-l-orange-500 dark:border-l-orange-400",
      red: "border-l-red-500 dark:border-l-red-400",
      purple: "border-l-purple-500 dark:border-l-purple-400",
      indigo: "border-l-indigo-500 dark:border-l-indigo-400",
      cyan: "border-l-cyan-500 dark:border-l-cyan-400",
      default: "border-l-primary",
    },
  },
  defaultVariants: {
    accentColor: "default",
  },
});

const iconBgMap: Record<string, string> = {
  blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
  green: "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400",
  orange:
    "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400",
  red: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
  purple:
    "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400",
  indigo:
    "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400",
  cyan: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400",
  default: "bg-primary/10 text-primary",
};

interface StatCardProps extends VariantProps<typeof statCardVariants> {
  label: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  className?: string;
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  function StatCard(
    {
      label,
      value,
      icon: Icon,
      accentColor = "default",
      description,
      className,
    },
    ref,
  ) {
    const colorKey = accentColor ?? "default";

    return (
      <Card
        ref={ref}
        className={cn(statCardVariants({ accentColor }), "p-4", className)}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              iconBgMap[colorKey],
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {label}
            </p>
            <p className="text-xl font-bold truncate">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {description}
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  },
);

interface RadialProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}

export function RadialProgress({
  value,
  size = 120,
  strokeWidth = 8,
  className,
  children,
}: RadialProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(value, 0), 100) / 100);

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}
