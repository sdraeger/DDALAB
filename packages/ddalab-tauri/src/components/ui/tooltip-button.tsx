"use client";

import * as React from "react";
import { Button, ButtonProps } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface TooltipButtonProps extends ButtonProps {
  /** Tooltip text shown on hover. For disabled buttons, shows the reason why it's disabled. */
  tooltip?: string;
  /** Side of the button to show tooltip */
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Delay before showing tooltip (ms) */
  tooltipDelay?: number;
}

/**
 * Button with tooltip support that works even when the button is disabled.
 *
 * Use this component when:
 * - You need to explain why a button is disabled
 * - You want to provide additional context on hover
 *
 * @example
 * ```tsx
 * <TooltipButton
 *   disabled={!isConnected}
 *   tooltip={!isConnected ? "Connect to server first" : "Submit analysis"}
 *   onClick={handleSubmit}
 * >
 *   Submit
 * </TooltipButton>
 * ```
 */
export const TooltipButton = React.forwardRef<
  HTMLButtonElement,
  TooltipButtonProps
>(
  (
    {
      tooltip,
      tooltipSide = "top",
      tooltipDelay = 300,
      className,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    // If no tooltip, render a regular button
    if (!tooltip) {
      return (
        <Button ref={ref} disabled={disabled} className={className} {...props}>
          {children}
        </Button>
      );
    }

    // Wrap in tooltip - use span wrapper to allow tooltip on disabled buttons
    return (
      <TooltipProvider delayDuration={tooltipDelay}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Span wrapper allows tooltip to work on disabled buttons */}
            <span
              className={cn("inline-flex", disabled && "cursor-not-allowed")}
            >
              <Button
                ref={ref}
                disabled={disabled}
                className={cn(className, disabled && "pointer-events-none")}
                {...props}
              >
                {children}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            <p className="max-w-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);

TooltipButton.displayName = "TooltipButton";

/**
 * Helper to generate tooltip text for common disabled states
 */
export function getDisabledReason(conditions: {
  isRunning?: boolean;
  noFile?: boolean;
  noChannels?: boolean;
  noConnection?: boolean;
  noCredentials?: boolean;
  customReason?: string;
}): string | undefined {
  if (conditions.customReason) return conditions.customReason;
  if (conditions.isRunning) return "Analysis is currently running";
  if (conditions.noFile) return "Select a file first";
  if (conditions.noChannels) return "Configure channels first";
  if (conditions.noConnection) return "Not connected to server";
  if (conditions.noCredentials) return "Configure credentials in Settings";
  return undefined;
}
