import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Circle,
  CircleCheck,
  AlertTriangle,
  Activity,
  Brain,
  Zap,
} from "lucide-react";
import type { ICAComponent } from "@/types/ica";

interface ICAComponentCardProps {
  component: ICAComponent;
  channelNames: string[];
  isSelected: boolean;
  isMarked: boolean;
  onClick: () => void;
  onToggleMarked: () => void;
}

/** Thresholds for artifact classification heuristics */
const CLASSIFICATION_THRESHOLDS = {
  kurtosis: {
    high: 5, // Likely artifact (eye blink, muscle)
    elevated: 3, // Possibly artifact
  },
  variance: {
    high: 15, // High variance component
  },
} as const;

/** Get artifact classification hint based on component statistics */
function getClassificationHint(component: ICAComponent): {
  type: "artifact" | "suspicious" | "neural" | "unknown";
  label: string;
  icon: React.ReactNode;
  color: string;
} {
  const absKurtosis = Math.abs(component.kurtosis);

  // High kurtosis often indicates artifacts (blinks, muscle)
  if (absKurtosis > CLASSIFICATION_THRESHOLDS.kurtosis.high) {
    return {
      type: "artifact",
      label: "Likely artifact",
      icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
      color: "text-orange-500",
    };
  }

  // Elevated kurtosis is suspicious
  if (absKurtosis > CLASSIFICATION_THRESHOLDS.kurtosis.elevated) {
    return {
      type: "suspicious",
      label: "Review",
      icon: <Zap className="h-3 w-3" aria-hidden="true" />,
      color: "text-yellow-500",
    };
  }

  // Low kurtosis and reasonable variance suggests neural activity
  if (
    absKurtosis <= CLASSIFICATION_THRESHOLDS.kurtosis.elevated &&
    component.variance_explained > 1
  ) {
    return {
      type: "neural",
      label: "Neural",
      icon: <Brain className="h-3 w-3" aria-hidden="true" />,
      color: "text-green-500",
    };
  }

  return {
    type: "unknown",
    label: "Unknown",
    icon: <Activity className="h-3 w-3" aria-hidden="true" />,
    color: "text-muted-foreground",
  };
}

export function ICAComponentCard({
  component,
  channelNames,
  isSelected,
  isMarked,
  onClick,
  onToggleMarked,
}: ICAComponentCardProps) {
  const classification = useMemo(
    () => getClassificationHint(component),
    [component],
  );

  // Get top contributing channels
  const topChannels = useMemo(() => {
    const channelWeights = component.spatial_map.map((weight, idx) => ({
      name: channelNames[idx] || `Ch${idx}`,
      weight: Math.abs(weight),
    }));
    channelWeights.sort((a, b) => b.weight - a.weight);
    return channelWeights.slice(0, 2);
  }, [component, channelNames]);

  // Kurtosis color based on value
  const kurtosisColor =
    Math.abs(component.kurtosis) > CLASSIFICATION_THRESHOLDS.kurtosis.high
      ? "text-orange-500"
      : Math.abs(component.kurtosis) >
          CLASSIFICATION_THRESHOLDS.kurtosis.elevated
        ? "text-yellow-500"
        : "text-green-500";

  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`Component ${component.component_id + 1}, ${classification.label}, ${isMarked ? "marked for removal" : "not marked"}`}
        className={cn(
          "p-2.5 rounded-lg border cursor-pointer transition-all",
          "hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected
            ? "border-primary bg-primary/5 shadow-sm"
            : "border-border hover:border-primary/50",
          isMarked && "bg-red-500/10 border-red-300 dark:border-red-800",
        )}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-sm">
            IC {component.component_id + 1}
          </span>
          <div className="flex items-center gap-1.5">
            {/* Classification Badge */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0 h-5",
                    classification.color,
                  )}
                >
                  {classification.icon}
                  <span className="ml-1">{classification.label}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">
                  {classification.type === "artifact"
                    ? "High kurtosis suggests this may be an artifact (e.g., eye blink, muscle)"
                    : classification.type === "suspicious"
                      ? "Elevated kurtosis - review this component carefully"
                      : classification.type === "neural"
                        ? "Statistics suggest this is likely neural activity"
                        : "Unable to classify - review manually"}
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Mark/Unmark Button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-5 w-5 rounded-full p-0",
                    isMarked && "text-red-500 hover:text-red-600",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMarked();
                  }}
                  aria-label={
                    isMarked ? "Unmark component" : "Mark as artifact"
                  }
                >
                  {isMarked ? (
                    <CircleCheck className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Circle className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isMarked ? "Click to unmark" : "Mark as artifact for removal"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Stats */}
        <div className="text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Kurtosis:</span>
            <span className={kurtosisColor}>
              {component.kurtosis.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Variance:</span>
            <span>{component.variance_explained.toFixed(1)}%</span>
          </div>
          <div
            className="text-[10px] text-muted-foreground mt-1.5 truncate"
            title={topChannels.map((c) => c.name).join(", ")}
          >
            Top: {topChannels.map((c) => c.name).join(", ")}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default ICAComponentCard;
