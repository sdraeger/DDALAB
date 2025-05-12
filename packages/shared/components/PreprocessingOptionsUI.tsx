"use client";

import { UseFormReturn } from "react-hook-form";
import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "shared/components/ui/form";
import { Button } from "shared/components/ui/button";
import { Card } from "shared/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "shared/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "shared/components/ui/dropdown-menu";
import { ArrowDown, ArrowUp, GripVertical, PlusCircle, X } from "lucide-react";
import { FormValues } from "./dda-form"; // Assuming FormValues is exported from dda-form.tsx

// Define available preprocessing steps (can also be passed as prop if needed elsewhere)
const availablePreprocessingSteps = [
  { id: "resample1000hz", label: "Resample to 1000Hz" },
  { id: "resample500hz", label: "Resample to 500Hz" },
  { id: "lowpassFilter", label: "Low-pass Filter" },
  { id: "highpassFilter", label: "High-pass Filter" },
  { id: "notchFilter", label: "Notch Filter" },
  { id: "detrend", label: "Detrend" },
];

interface PreprocessingOptionsUIProps {
  form: UseFormReturn<FormValues>; // Pass the entire form hook result
}

export function PreprocessingOptionsUI({ form }: PreprocessingOptionsUIProps) {
  const { control, getValues, setValue, watch } = form;
  const preprocessingStepsWatch = watch("preprocessingSteps"); // Watch for UI updates

  const addPreprocessingStep = (step: { id: string; label: string }) => {
    const currentSteps = getValues("preprocessingSteps");
    if (
      !currentSteps.find((s: { id: string; label: string }) => s.id === step.id)
    ) {
      setValue("preprocessingSteps", [...currentSteps, step], {
        shouldValidate: true,
      });
    }
  };

  const removePreprocessingStep = (stepId: string) => {
    const currentSteps = getValues("preprocessingSteps");
    setValue(
      "preprocessingSteps",
      currentSteps.filter(
        (s: { id: string; label: string }) => s.id !== stepId
      ),
      { shouldValidate: true }
    );
  };

  const movePreprocessingStep = (index: number, direction: "up" | "down") => {
    const currentSteps = getValues("preprocessingSteps");
    const newSteps = [...currentSteps];
    const stepToMove = newSteps[index];

    if (direction === "up" && index > 0) {
      newSteps.splice(index, 1);
      newSteps.splice(index - 1, 0, stepToMove);
    } else if (direction === "down" && index < newSteps.length - 1) {
      newSteps.splice(index, 1);
      newSteps.splice(index + 1, 0, stepToMove);
    }
    setValue("preprocessingSteps", newSteps, { shouldValidate: true });
  };

  return (
    <FormField
      control={control}
      name="preprocessingSteps"
      render={({ field }) => (
        <FormItem className="col-span-full">
          <FormLabel>Preprocessing Pipeline</FormLabel>
          <FormDescription>
            Define the sequence of preprocessing steps. Steps are applied in
            order.
          </FormDescription>
          <div className="space-y-3 mt-2">
            {field.value.length > 0 && (
              <Card className="p-4 space-y-2 bg-muted/30">
                {field.value.map(
                  (step: { id: string; label: string }, index: number) => (
                    <div
                      key={step.id}
                      className="flex items-center justify-between p-2 rounded-md border bg-background hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />{" "}
                        {/* Placeholder for DnD */}
                        <span className="font-medium">{step.label}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => movePreprocessingStep(index, "up")}
                          disabled={index === 0}
                          className="h-7 w-7"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => movePreprocessingStep(index, "down")}
                          disabled={index === field.value.length - 1}
                          className="h-7 w-7"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removePreprocessingStep(step.id)}
                          className="h-7 w-7 text-destructive hover:text-destructive/80"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                )}
              </Card>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full md:w-auto">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add Preprocessing Step
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <Command>
                  <CommandInput placeholder="Filter steps..." />
                  <CommandList>
                    <CommandEmpty>No steps found.</CommandEmpty>
                    <CommandGroup>
                      {availablePreprocessingSteps
                        .filter(
                          (availableStep) =>
                            !field.value.some(
                              (selectedStep: { id: string; label: string }) =>
                                selectedStep.id === availableStep.id
                            )
                        )
                        .map((availableStep) => (
                          <CommandItem
                            key={availableStep.id}
                            value={availableStep.label}
                            onSelect={() => {
                              addPreprocessingStep(availableStep);
                            }}
                            className="cursor-pointer"
                          >
                            {availableStep.label}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </DropdownMenuContent>
            </DropdownMenu>
            {field.value.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No preprocessing steps added. Click "Add Preprocessing Step" to
                begin.
              </p>
            )}
          </div>
          {/* Ensure FormMessage is shown if there are errors specific to this field */}
        </FormItem>
      )}
    />
  );
}
