/**
 * Compact channel configuration component for DDA variants
 * Provides a scalable accordion-based UI for per-variant channel selection
 */

"use client";

import React, {
  useDeferredValue,
  useTransition,
  useState,
  useEffect,
  memo,
} from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChannelSelector } from "@/components/ChannelSelector";
import { CTChannelPairPicker } from "@/components/CTChannelPairPicker";
import { CDChannelPairPicker } from "@/components/CDChannelPairPicker";
import { X } from "lucide-react";
import type { VariantMetadata } from "@/types/variantConfig";

// Use shared VariantMetadata type - only need subset of fields for display
type VariantConfig = Pick<
  VariantMetadata,
  "id" | "name" | "abbreviation" | "color" | "rgb"
>;

interface CompactChannelConfigProps {
  variant: VariantConfig;
  channels: string[];
  disabled?: boolean;
  // ST/DE/SY specific
  selectedChannels?: string[];
  onChannelsChange?: (channels: string[]) => void;
  // CT specific
  ctChannelPairs?: [string, string][];
  onCTChannelPairsChange?: (pairs: [string, string][]) => void;
  // CD specific
  cdChannelPairs?: [string, string][];
  onCDChannelPairsChange?: (pairs: [string, string][]) => void;
}

// Internal component (will be wrapped with memo at export)
const CompactChannelConfigComponent = ({
  variant,
  channels,
  disabled = false,
  selectedChannels = [],
  onChannelsChange,
  ctChannelPairs = [],
  onCTChannelPairsChange,
  cdChannelPairs = [],
  onCDChannelPairsChange,
}: CompactChannelConfigProps) => {
  const getChannelCount = () => {
    if (variant.id === "cross_timeseries" || variant.id === "CT") {
      return ctChannelPairs.length;
    }
    if (variant.id === "cross_dynamical" || variant.id === "CD") {
      return cdChannelPairs.length;
    }
    return selectedChannels.length;
  };

  const count = getChannelCount();
  const requiresPairs =
    variant.id === "cross_timeseries" ||
    variant.id === "cross_dynamical" ||
    variant.id === "CT" ||
    variant.id === "CD";

  return (
    <AccordionItem value={variant.id} className="border rounded-lg px-3 py-1">
      <AccordionTrigger className="hover:no-underline py-2">
        <div className="flex items-center gap-2 w-full">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded shadow-sm flex-shrink-0"
            style={{
              backgroundColor: variant.color,
              color: "white",
            }}
          >
            {variant.abbreviation}
          </span>
          <span className="text-xs font-medium flex-1 text-left">
            {variant.name}
          </span>
          {count > 0 ? (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 ml-auto mr-2"
            >
              {count} {requiresPairs ? "pairs" : "ch"}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 ml-auto mr-2 text-muted-foreground"
            >
              none
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-2 pb-1 space-y-3">
          {/* Single channel selection (ST, DE, SY) */}
          {!requiresPairs && onChannelsChange && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Select Channels</span>
                {selectedChannels.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onChannelsChange([])}
                    disabled={disabled}
                  >
                    Clear All
                  </Button>
                )}
              </div>
              <ChannelSelector
                channels={channels}
                selectedChannels={selectedChannels}
                onSelectionChange={onChannelsChange}
                disabled={disabled}
                variant="compact"
                showSelectAll={false}
                showSearch={channels.length > 8}
                maxHeight="max-h-32"
              />
            </div>
          )}

          {/* CT channel pairs */}
          {variant.id === "cross_timeseries" && onCTChannelPairsChange && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Channel Pairs</span>
                {ctChannelPairs.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onCTChannelPairsChange([])}
                    disabled={disabled}
                  >
                    Clear All
                  </Button>
                )}
              </div>

              {ctChannelPairs.length > 0 && (
                <div className="flex flex-wrap gap-1 p-2 bg-muted/30 rounded-md">
                  {ctChannelPairs.map(([ch1, ch2], idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="text-[10px] cursor-pointer hover:bg-destructive/80 px-1.5 py-0.5"
                      onClick={() => {
                        if (!disabled) {
                          onCTChannelPairsChange(
                            ctChannelPairs.filter((_, i) => i !== idx),
                          );
                        }
                      }}
                    >
                      {ch1} ⟷ {ch2} <X className="h-2 w-2 ml-0.5" />
                    </Badge>
                  ))}
                </div>
              )}

              <CTChannelPairPicker
                channels={channels}
                onPairAdded={(ch1, ch2) => {
                  onCTChannelPairsChange([...ctChannelPairs, [ch1, ch2]]);
                }}
                disabled={disabled}
              />
            </div>
          )}

          {/* CD channel pairs (directed) */}
          {variant.id === "cross_dynamical" && onCDChannelPairsChange && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  Directed Pairs (From → To)
                </span>
                {cdChannelPairs.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onCDChannelPairsChange([])}
                    disabled={disabled}
                  >
                    Clear All
                  </Button>
                )}
              </div>

              {cdChannelPairs.length > 0 && (
                <div className="flex flex-wrap gap-1 p-2 bg-muted/30 rounded-md">
                  {cdChannelPairs.map(([from, to], idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="text-[10px] cursor-pointer hover:bg-destructive/80 px-1.5 py-0.5"
                      onClick={() => {
                        if (!disabled) {
                          onCDChannelPairsChange(
                            cdChannelPairs.filter((_, i) => i !== idx),
                          );
                        }
                      }}
                    >
                      {from} → {to} <X className="h-2 w-2 ml-0.5" />
                    </Badge>
                  ))}
                </div>
              )}

              <CDChannelPairPicker
                channels={channels}
                onPairAdded={(from, to) => {
                  onCDChannelPairsChange([...cdChannelPairs, [from, to]]);
                }}
                disabled={disabled}
              />
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
};

CompactChannelConfigComponent.displayName = "CompactChannelConfig";

export const CompactChannelConfig = memo(CompactChannelConfigComponent);

interface CompactChannelConfigGroupProps {
  variants: VariantConfig[];
  selectedVariants: string[];
  channels: string[];
  disabled?: boolean;
  // Channel configurations
  channelConfigs: {
    [variantId: string]: {
      selectedChannels?: string[];
      ctChannelPairs?: [string, string][];
      cdChannelPairs?: [string, string][];
    };
  };
  onConfigChange: (variantId: string, config: any) => void;
}

// Loading skeleton component
const VariantConfigSkeleton = () => (
  <div className="space-y-2 animate-pulse">
    <div className="h-12 bg-muted/50 rounded-lg" />
    <div className="h-12 bg-muted/30 rounded-lg" />
    <div className="h-12 bg-muted/20 rounded-lg" />
  </div>
);

export const CompactChannelConfigGroup: React.FC<
  CompactChannelConfigGroupProps
> = ({
  variants,
  selectedVariants,
  channels,
  disabled = false,
  channelConfigs,
  onConfigChange,
}) => {
  const [isPending, startTransition] = useTransition();
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [renderedVariants, setRenderedVariants] = useState<string[]>([]);

  // Use deferred value to keep UI responsive during updates
  const deferredSelectedVariants = useDeferredValue(selectedVariants);

  const enabledVariants = variants.filter((v) =>
    deferredSelectedVariants.includes(v.id),
  );

  // Handle initial load and variant changes with transitions
  useEffect(() => {
    if (isInitialLoad && enabledVariants.length > 0) {
      // On initial load, render variants progressively to avoid blocking
      const variantIds = enabledVariants.map((v) => v.id);

      // Only open the first variant by default instead of all
      setRenderedVariants([variantIds[0]]);
      setIsInitialLoad(false);
    } else if (enabledVariants.length > 0) {
      // When variants change, use transition to keep UI responsive
      startTransition(() => {
        setRenderedVariants(enabledVariants.map((v) => v.id));
      });
    } else {
      setRenderedVariants([]);
    }
  }, [enabledVariants.length, isInitialLoad]);

  if (enabledVariants.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Channel Configuration</h3>
        <Badge variant="outline" className="text-[10px]">
          {enabledVariants.length} variant
          {enabledVariants.length !== 1 ? "s" : ""}
        </Badge>
        {isPending && (
          <span className="text-[10px] text-muted-foreground animate-pulse">
            Loading...
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Configure channel selection for each enabled variant
      </p>

      {isPending && isInitialLoad ? (
        <VariantConfigSkeleton />
      ) : (
        <Accordion
          type="multiple"
          defaultValue={
            renderedVariants.length > 0 ? [renderedVariants[0]] : []
          }
          className="space-y-2"
        >
          {enabledVariants.map((variant) => {
            const config = channelConfigs[variant.id] || {};
            return (
              <CompactChannelConfig
                key={variant.id}
                variant={variant}
                channels={channels}
                disabled={disabled}
                selectedChannels={config.selectedChannels}
                onChannelsChange={(channels) => {
                  onConfigChange(variant.id, {
                    ...config,
                    selectedChannels: channels,
                  });
                }}
                ctChannelPairs={config.ctChannelPairs}
                onCTChannelPairsChange={(pairs) => {
                  onConfigChange(variant.id, {
                    ...config,
                    ctChannelPairs: pairs,
                  });
                }}
                cdChannelPairs={config.cdChannelPairs}
                onCDChannelPairsChange={(pairs) => {
                  onConfigChange(variant.id, {
                    ...config,
                    cdChannelPairs: pairs,
                  });
                }}
              />
            );
          })}
        </Accordion>
      )}
    </div>
  );
};
