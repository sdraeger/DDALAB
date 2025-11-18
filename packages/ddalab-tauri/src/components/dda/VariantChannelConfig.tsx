import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { ChannelSelector } from "@/components/ChannelSelector";
import { CTChannelPairPicker } from "@/components/CTChannelPairPicker";
import { CDChannelPairPicker } from "@/components/CDChannelPairPicker";
import {
  VariantChannelConfig as VariantChannelConfigType,
  VariantMetadata,
} from "@/types/variantConfig";
import { cn } from "@/lib/utils";

interface VariantChannelConfigProps {
  variant: VariantMetadata;
  config: VariantChannelConfigType;
  availableChannels: string[];
  onChange: (config: VariantChannelConfigType) => void;
  disabled?: boolean;
  defaultExpanded?: boolean;
}

export function VariantChannelConfig({
  variant,
  config,
  availableChannels,
  onChange,
  disabled = false,
  defaultExpanded = true,
}: VariantChannelConfigProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleChannelsChange = (channels: string[]) => {
    onChange({
      ...config,
      channels,
    });
  };

  const handlePairAdd = (ch1: string, ch2: string) => {
    onChange({
      ...config,
      channelPairs: [...(config.channelPairs || []), [ch1, ch2]],
    });
  };

  const handlePairRemove = (index: number) => {
    onChange({
      ...config,
      channelPairs: (config.channelPairs || []).filter((_, i) => i !== index),
    });
  };

  const handleDirectedPairAdd = (from: string, to: string) => {
    onChange({
      ...config,
      directedPairs: [...(config.directedPairs || []), [from, to]],
    });
  };

  const handleDirectedPairRemove = (index: number) => {
    onChange({
      ...config,
      directedPairs: (config.directedPairs || []).filter((_, i) => i !== index),
    });
  };

  const getChannelCount = () => {
    if (variant.channelType === "individual") {
      return config.channels?.length || 0;
    } else if (variant.channelType === "pairs") {
      return config.channelPairs?.length || 0;
    } else if (variant.channelType === "directed_pairs") {
      return config.directedPairs?.length || 0;
    }
    return 0;
  };

  const getConfigSummary = () => {
    const count = getChannelCount();
    if (variant.channelType === "individual") {
      return count === 0
        ? "No channels selected"
        : `${count} channel${count !== 1 ? "s" : ""}`;
    } else if (variant.channelType === "pairs") {
      return count === 0
        ? "No pairs selected"
        : `${count} pair${count !== 1 ? "s" : ""}`;
    } else if (variant.channelType === "directed_pairs") {
      return count === 0
        ? "No directed pairs selected"
        : `${count} directed pair${count !== 1 ? "s" : ""}`;
    }
    return "";
  };

  const hasValidConfig = getChannelCount() > 0;

  return (
    <Card className={cn("border-l-4", variant.borderColor)}>
      <CardHeader className="pb-3">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3 flex-1">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: variant.color }}
                />
                {variant.name} ({variant.abbreviation})
                <Badge
                  variant={hasValidConfig ? "default" : "secondary"}
                  className={cn(
                    "ml-2",
                    hasValidConfig
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
                  )}
                >
                  {getConfigSummary()}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                {variant.description}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Individual Channels (ST, DE, SY) */}
          {variant.channelType === "individual" && (
            <div>
              <Label className="text-sm font-semibold mb-2 block">
                Channel Selection
              </Label>
              <p className="text-xs text-muted-foreground mb-3">
                Select individual channels for {variant.abbreviation} analysis
              </p>
              <ChannelSelector
                channels={availableChannels}
                selectedChannels={config.channels || []}
                onSelectionChange={handleChannelsChange}
                variant="compact"
                maxHeight="max-h-32"
                disabled={disabled}
              />
            </div>
          )}

          {/* Channel Pairs (CT) */}
          {variant.channelType === "pairs" && (
            <div>
              <Label className="text-sm font-semibold mb-2 block">
                Channel Pairs
              </Label>
              <p className="text-xs text-muted-foreground mb-3">
                Select channel pairs for {variant.abbreviation} analysis
                (bidirectional)
              </p>

              {/* Display current pairs */}
              {(config.channelPairs?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {config.channelPairs?.map(([ch1, ch2], idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive/20 transition-colors"
                      onClick={() => {
                        if (!disabled) {
                          handlePairRemove(idx);
                        }
                      }}
                    >
                      {ch1} ⟷ {ch2}
                      <X className="ml-1 h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              )}

              {(config.channelPairs?.length ?? 0) === 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                  No pairs selected. Please add at least one pair.
                </p>
              )}

              {/* Channel pair picker */}
              <CTChannelPairPicker
                channels={availableChannels}
                onPairAdded={handlePairAdd}
                disabled={disabled}
              />
            </div>
          )}

          {/* Directed Pairs (CD) */}
          {variant.channelType === "directed_pairs" && (
            <div>
              <Label className="text-sm font-semibold mb-2 block">
                Directed Channel Pairs
              </Label>
              <p className="text-xs text-muted-foreground mb-3">
                Select directed channel pairs for {variant.abbreviation}{" "}
                analysis (From → To)
              </p>

              {/* Display current directed pairs */}
              {(config.directedPairs?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {config.directedPairs?.map(([from, to], idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive/20 transition-colors"
                      onClick={() => {
                        if (!disabled) {
                          handleDirectedPairRemove(idx);
                        }
                      }}
                    >
                      {from} → {to}
                      <X className="ml-1 h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              )}

              {(config.directedPairs?.length ?? 0) === 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                  No directed pairs selected. Please add at least one pair.
                </p>
              )}

              {/* Directed channel pair picker */}
              <CDChannelPairPicker
                channels={availableChannels}
                onPairAdded={handleDirectedPairAdd}
                disabled={disabled}
              />
            </div>
          )}

          {/* Additional info for CT-requiring variants */}
          {variant.requiresCTParameters && (
            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
              <strong>Note:</strong> This variant requires CT window parameters
              (window length and step). Configure these in the parameters
              section above.
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
