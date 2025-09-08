"use client";

import React from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Checkbox,
  Label,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "../ui";

interface DDAVariant {
  id: string;
  name: string;
  description: string;
  abbreviation: string;
  index: number;
  enabled: boolean;
}

interface DDAVariantSelectorProps {
  variants: DDAVariant[];
  onChange: (variants: DDAVariant[]) => void;
  allowMultiple?: boolean;
  className?: string;
}

export function DDAVariantSelector({
  variants,
  onChange,
  allowMultiple = true,
  className = "",
}: DDAVariantSelectorProps) {
  const handleVariantToggle = (variantId: string, enabled: boolean) => {
    const updated = variants.map((variant) => {
      if (variant.id === variantId) {
        return { ...variant, enabled };
      }
      // If single selection mode, disable others when enabling one
      if (!allowMultiple && enabled) {
        return { ...variant, enabled: false };
      }
      return variant;
    });

    onChange(updated);
  };

  const handleSelectAll = () => {
    if (!allowMultiple) return;
    const updated = variants.map((variant) => ({ ...variant, enabled: true }));
    onChange(updated);
  };

  const handleSelectNone = () => {
    const updated = variants.map((variant) => ({ ...variant, enabled: false }));
    onChange(updated);
  };

  const enabledCount = variants.filter((v) => v.enabled).length;

  return (
    <Card className={`${className}`}>
      <CardHeader className="pb-2 pt-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Settings2 className="h-3 w-3" />
            Algorithm Variants
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {enabledCount}/{variants.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-2">
        {/* Quick selection buttons */}
        {allowMultiple && (
          <div className="flex gap-1 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              className="h-5 px-2 text-xs"
              disabled={enabledCount === variants.length}
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectNone}
              className="h-5 px-2 text-xs"
              disabled={enabledCount === 0}
            >
              None
            </Button>
          </div>
        )}

        {/* Variant selection list */}
        <div className="space-y-1">
          {variants.map((variant) => (
            <div
              key={variant.id}
              className={`flex items-start space-x-2 p-2 border rounded text-xs transition-colors ${
                variant.enabled
                  ? "bg-blue-50 border-blue-200"
                  : "bg-gray-50 border-gray-200"
              }`}
            >
              <Checkbox
                checked={variant.enabled}
                onCheckedChange={(checked) =>
                  handleVariantToggle(variant.id, checked as boolean)
                }
                className="h-3 w-3 mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium cursor-pointer">
                    {variant.name}
                  </Label>
                  <Badge
                    variant={variant.enabled ? "default" : "secondary"}
                    className="text-xs h-4 px-1"
                  >
                    {variant.abbreviation}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  {variant.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Selection info */}
        {enabledCount > 0 && (
          <div className="text-xs text-muted-foreground pt-1 border-t">
            Selected: {variants.filter(v => v.enabled).map(v => v.abbreviation).join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { DDAVariant };