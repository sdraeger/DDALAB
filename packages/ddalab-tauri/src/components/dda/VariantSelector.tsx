/**
 * VariantSelector Component
 *
 * Card for selecting DDA algorithm variants to run.
 * Displays variants with color coding and selection checkboxes.
 * Extracted from DDAAnalysis.tsx to reduce component complexity.
 *
 * Re-exports variant utilities from the canonical source in types/variantConfig.ts
 */

import { memo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  VARIANT_REGISTRY,
  VARIANT_ORDER,
  getVariantColor,
  getVariantMetadata,
  type VariantMetadata,
} from "@/types/variantConfig";

// Re-export types and utilities for backward compatibility
export type DDAVariant = VariantMetadata;
export const DDA_VARIANTS = VARIANT_REGISTRY;
export { VARIANT_ORDER, getVariantColor };

/**
 * Get a variant by its ID.
 */
export function getVariantById(variantId: string): DDAVariant | undefined {
  return getVariantMetadata(variantId);
}

interface VariantSelectorProps {
  selectedVariants: string[];
  onVariantsChange: (variants: string[]) => void;
  disabled?: boolean;
}

export const VariantSelector = memo(function VariantSelector({
  selectedVariants,
  onVariantsChange,
  disabled = false,
}: VariantSelectorProps) {
  const handleVariantToggle = (variantId: string, checked: boolean) => {
    const newVariants = checked
      ? [...selectedVariants, variantId]
      : selectedVariants.filter((v) => v !== variantId);
    onVariantsChange(newVariants);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Algorithm Selection</CardTitle>
        <CardDescription className="text-xs">
          Choose DDA variants to compute
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {DDA_VARIANTS.map((variant) => {
          const isSelected = selectedVariants.includes(variant.id);
          return (
            <div
              key={variant.id}
              className="flex items-start space-x-3 p-4 rounded-lg border-l-[6px] transition-all duration-200 hover:shadow-sm"
              style={{
                borderLeftColor: variant.color,
                backgroundColor: isSelected
                  ? `rgba(${variant.rgb}, 0.25)`
                  : `rgba(${variant.rgb}, 0.15)`,
                boxShadow: isSelected
                  ? `0 0 0 1px rgba(${variant.rgb}, 0.4)`
                  : "none",
              }}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) =>
                  handleVariantToggle(variant.id, checked === true)
                }
                disabled={disabled}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-semibold">
                    {variant.name}
                  </Label>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded shadow-sm"
                    style={{
                      backgroundColor: variant.color,
                      color: "white",
                    }}
                  >
                    {variant.abbreviation}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                  {variant.description}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
});
