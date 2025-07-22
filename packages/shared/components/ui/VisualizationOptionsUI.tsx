"use client";

import { UseFormReturn } from "react-hook-form";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "shared/components/ui/form";
import { Checkbox } from "shared/components/ui/checkbox";
import { FormValues } from "../../types/preprocessing";

interface VisualizationOptionsUIProps {
  form: UseFormReturn<FormValues>;
}

export function VisualizationOptionsUI({ form }: VisualizationOptionsUIProps) {
  const { control, watch } = form;

  return (
    <>
      <div className="col-span-full mt-6">
        <h4 className="text-sm font-medium mb-3 text-muted-foreground">
          Visualization Options
        </h4>
      </div>

      <FormField
        control={control}
        name="removeOutliers"
        render={({ field }) => (
          <FormItem
            className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${field.value ? "bg-primary/10 border-primary/20" : ""
              }`}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest(".checkbox-container")) {
                field.onChange(!field.value);
              }
            }}
          >
            <FormControl>
              <div className="checkbox-container">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel className="cursor-pointer">Remove Outliers</FormLabel>
              <FormDescription>
                Remove extreme values from the signal
              </FormDescription>
            </div>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="smoothing"
        render={({ field }) => (
          <FormItem
            className={`flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 cursor-pointer hover:bg-muted/50 transition-colors ${field.value ? "bg-primary/10 border-primary/20" : ""
              }`}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest(".checkbox-container")) {
                field.onChange(!field.value);
              }
            }}
          >
            <FormControl>
              <div className="checkbox-container">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel className="cursor-pointer">Apply Smoothing</FormLabel>
              <FormDescription>
                Smooth the signal to reduce noise
              </FormDescription>
            </div>
          </FormItem>
        )}
      />

      {watch("smoothing") && (
        <FormField
          control={control}
          name="smoothingWindow"
          render={({ field }) => (
            <FormItem className="rounded-md border p-4 space-y-2">
              <FormLabel>Smoothing Window</FormLabel>
              <FormDescription>
                Window size for smoothing filter: {field.value}
              </FormDescription>
              <FormControl>
                <input
                  type="range"
                  min={3}
                  max={15}
                  step={2}
                  value={field.value}
                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}

      <FormField
        control={control}
        name="normalization"
        render={({ field }) => (
          <FormItem className="rounded-md border p-4 space-y-2">
            <FormLabel>Normalization</FormLabel>
            <FormDescription>
              Choose signal normalization method
            </FormDescription>
            <FormControl>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={field.value}
                onChange={field.onChange}
              >
                <option value="none">None</option>
                <option value="minmax">Min-Max</option>
                <option value="zscore">Z-Score</option>
              </select>
            </FormControl>
          </FormItem>
        )}
      />
    </>
  );
}
