"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { VariantSelector } from "@/components/dda/VariantSelector";
import { DelayPresetManager } from "@/components/dda/DelayPresetManager";
import type { BatchSharedParameters } from "@/store/slices/batchSlice";

interface BatchParameterPanelProps {
  params: BatchSharedParameters;
  onParamsChange: (params: BatchSharedParameters) => void;
  continueOnError: boolean;
  onContinueOnErrorChange: (value: boolean) => void;
  disabled?: boolean;
}

export function BatchParameterPanel({
  params,
  onParamsChange,
  continueOnError,
  onContinueOnErrorChange,
  disabled = false,
}: BatchParameterPanelProps) {
  return (
    <div className="space-y-4">
      <VariantSelector
        selectedVariants={params.variants}
        onVariantsChange={(variants) => onParamsChange({ ...params, variants })}
        disabled={disabled}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Window Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Window Length (samples)</Label>
              <Input
                type="number"
                value={params.windowLength}
                onChange={(e) =>
                  onParamsChange({
                    ...params,
                    windowLength: Math.max(10, parseInt(e.target.value) || 10),
                  })
                }
                disabled={disabled}
                min={10}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Window Step (samples)</Label>
              <Input
                type="number"
                value={params.windowStep}
                onChange={(e) =>
                  onParamsChange({
                    ...params,
                    windowStep: Math.max(1, parseInt(e.target.value) || 1),
                  })
                }
                disabled={disabled}
                min={1}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <DelayPresetManager
        delays={params.delays}
        onChange={(delays) => onParamsChange({ ...params, delays })}
        disabled={disabled}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Batch Options</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Continue on Error</Label>
              <p className="text-xs text-muted-foreground">
                Process remaining files even if one fails
              </p>
            </div>
            <Switch
              checked={continueOnError}
              onCheckedChange={onContinueOnErrorChange}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
