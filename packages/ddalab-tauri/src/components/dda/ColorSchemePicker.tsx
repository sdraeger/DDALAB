"use client";

import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Palette, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColorScheme =
  | "viridis"
  | "plasma"
  | "inferno"
  | "jet"
  | "cool"
  | "hot";

interface ColorSchemeOption {
  value: ColorScheme;
  label: string;
  gradient: string;
  description: string;
}

const COLOR_SCHEMES: ColorSchemeOption[] = [
  {
    value: "viridis",
    label: "Viridis",
    gradient: "linear-gradient(90deg, #440154, #31688e, #35b779, #fde725)",
    description: "Perceptually uniform, colorblind-friendly",
  },
  {
    value: "plasma",
    label: "Plasma",
    gradient:
      "linear-gradient(90deg, #0d0887, #7e03a8, #cc4778, #f89540, #f0f921)",
    description: "High contrast, warm tones",
  },
  {
    value: "inferno",
    label: "Inferno",
    gradient:
      "linear-gradient(90deg, #000004, #420a68, #932667, #dd513a, #fca50a, #fcffa4)",
    description: "Dark to bright, fire-like",
  },
  {
    value: "jet",
    label: "Jet",
    gradient:
      "linear-gradient(90deg, #00007f, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000, #7f0000)",
    description: "Classic rainbow spectrum",
  },
  {
    value: "cool",
    label: "Cool",
    gradient: "linear-gradient(90deg, #00ffff, #ff00ff)",
    description: "Cyan to magenta",
  },
  {
    value: "hot",
    label: "Hot",
    gradient: "linear-gradient(90deg, #000000, #e60000, #ffff00, #ffffff)",
    description: "Black through red to white",
  },
];

interface ColorSchemePickerProps {
  value: ColorScheme;
  onValueChange: (value: ColorScheme) => void;
  className?: string;
}

export function ColorSchemePicker({
  value,
  onValueChange,
  className,
}: ColorSchemePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selectedScheme = COLOR_SCHEMES.find((s) => s.value === value);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-sm font-medium text-muted-foreground">
          Colors
        </span>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2 px-2 transition-all duration-200"
                >
                  <div
                    className="h-4 w-16 rounded-sm border shadow-inner"
                    style={{ background: selectedScheme?.gradient }}
                  />
                  <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="font-medium">{selectedScheme?.label}</div>
              <div className="text-xs text-muted-foreground">
                Click to change color scheme
              </div>
            </TooltipContent>
          </Tooltip>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="grid gap-1">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Color Schemes
              </div>
              {COLOR_SCHEMES.map((scheme) => {
                const isSelected = value === scheme.value;
                return (
                  <button
                    key={scheme.value}
                    onClick={() => {
                      onValueChange(scheme.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors duration-150",
                      "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected && "bg-accent",
                    )}
                  >
                    <div
                      className="h-5 w-12 rounded border shadow-inner flex-shrink-0"
                      style={{ background: scheme.gradient }}
                    />
                    <span className="text-sm font-medium flex-1">
                      {scheme.label}
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
